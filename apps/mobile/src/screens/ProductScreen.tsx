import type { MenuProduct, PricedItem } from "@beans/contracts";
import { MAX_ITEM_QUANTITY } from "@beans/contracts";
import { colors, radius, space, touchTarget } from "@beans/ui";
import { useEffect, useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import {
  Body,
  Button,
  Chip,
  ConfirmDialog,
  FailureText,
  Heading,
  RemoteState,
  Screen,
  styles,
} from "../components/ui";
import { localized, useI18n } from "../i18n";
import { api, ApiFailure, call } from "../lib/api";
import {
  chosenOptionIds,
  emptySelection,
  type Selection,
  selectionProblems,
  toggleOption,
} from "../lib/customizer";
import { formatFils } from "../lib/money";
import { useRemote } from "../lib/use-remote";
import type { RootParams, RootScreen } from "../navigation/types";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAction } from "../lib/use-action";
import { newIdempotencyKey } from "../lib/session";
import { useAppState } from "../state/app-state";
import type { AddRequest } from "../state/cart";

/** C05: options with min/max, quantity, notes. The price shown is always the server's. */
export function ProductScreen({ navigation, route }: RootScreen<"Product">) {
  const { branchId, productId } = route.params;
  const remote = useRemote(async () => {
    const path = { params: { path: { id: branchId } } };
    const [detail, menu] = await Promise.all([
      call(api.GET("/v1/branches/{id}", path)),
      call(api.GET("/v1/branches/{id}/menu", path)),
    ]);
    const product =
      menu.data.categories.flatMap((c) => c.products).find((p) => p.id === productId) ?? null;
    return { branch: detail.data, menuVersion: menu.data.version, product };
  }, [branchId, productId]);

  return (
    <Screen testID="product">
      <RemoteState remote={remote} isEmpty={(d) => d.product === null} empty={<Body>{"—"}</Body>}>
        {(d) =>
          d.product ? (
            <Customizer
              product={d.product}
              branchId={branchId}
              branchName={`${d.branch.brandName} · ${d.branch.names.en}`}
              menuVersion={d.menuVersion}
              onAdded={() => navigation.goBack()}
            />
          ) : null
        }
      </RemoteState>
    </Screen>
  );
}

function Customizer({
  product,
  branchId,
  branchName,
  menuVersion,
  onAdded,
}: {
  product: MenuProduct;
  branchId: string;
  branchName: string;
  menuVersion: string;
  onAdded: () => void;
}) {
  const { t, locale } = useI18n();
  const { addToCart, replaceCart } = useAppState();
  const [selection, setSelection] = useState<Selection>(() => emptySelection(product));
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [priced, setPriced] = useState<PricedItem | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [pending, setPending] = useState<AddRequest | null>(null);
  const [conflictBranch, setConflictBranch] = useState("");

  const problems = selectionProblems(product, selection);
  const optionIds = useMemo(() => chosenOptionIds(product, selection), [product, selection]);
  const ready = product.available && problems.length === 0;

  // Ask the server for the canonical price whenever a valid choice changes.
  useEffect(() => {
    setPriced(null);
    setPriceError(null);
    if (!ready) return;
    let cancelled = false;
    call(
      api.POST("/v1/branches/{id}/items/price", {
        params: { path: { id: branchId } },
        body: { productId: product.id, optionIds, quantity },
      }),
    )
      .then((res) => !cancelled && setPriced(res.data))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setPriceError(
            e instanceof ApiFailure && e.code === "OUT_OF_STOCK"
              ? t("product.unavailable")
              : t("common.error"),
          ),
      );
    return () => {
      cancelled = true;
    };
  }, [ready, branchId, product.id, optionIds, quantity, t]);

  const optionNames = product.groups.flatMap((g) =>
    g.options.filter((o) => optionIds.includes(o.id)).map((o) => localized(o.names, locale)),
  );

  function add() {
    if (!priced) return;
    const request: AddRequest = {
      branchId,
      branchName,
      menuVersion,
      line: {
        key: `${product.id}:${optionIds.join(",")}:${Date.now()}`,
        productId: product.id,
        name: localized(product.names, locale),
        optionIds,
        optionNames,
        quantity,
        unitFils: priced.unitFils,
        lineFils: priced.lineFils,
        notes: notes.trim(),
      },
    };
    const other = addToCart(request);
    if (other === null) onAdded();
    else {
      setConflictBranch(other);
      setPending(request);
    }
  }

  const firstMissing = problems.find((p) => p.kind === "too_few");
  const missingGroup = product.groups.find((g) => g.id === firstMissing?.groupId);
  const addLabel = !product.available
    ? t("product.unavailable")
    : !ready
      ? t("product.addUnavailable")
      : priced
        ? t("product.add", { price: formatFils(priced.lineFils, locale) })
        : (priceError ?? t("product.pricing"));

  return (
    <View style={{ gap: 12 }}>
      <Heading>{localized(product.names, locale)}</Heading>
      {product.descriptions.en ? (
        <Body>
          {localized({ en: product.descriptions.en, ar: product.descriptions.ar }, locale)}
        </Body>
      ) : null}
      <Body muted>{formatFils(product.priceFils, locale)}</Body>
      {product.allergens.length > 0 ? (
        <Body>{t("product.allergens", { list: product.allergens.join(", ") })}</Body>
      ) : null}
      {!product.available ? <Body>{t("product.unavailable")}</Body> : null}

      {product.groups.map((group) => {
        const groupName = localized(group.names, locale);
        const rule =
          group.minCount > 0 && group.minCount === group.maxCount
            ? t("product.required", { count: group.minCount })
            : group.minCount === 0
              ? t("product.upTo", { count: group.maxCount })
              : t("product.chooseRange", { min: group.minCount, max: group.maxCount });
        return (
          <View
            key={group.id}
            style={{ gap: 8 }}
            accessibilityRole={group.maxCount === 1 ? "radiogroup" : undefined}
          >
            <Heading level={2}>{groupName}</Heading>
            <Body muted>{rule}</Body>
            <View style={styles.row}>
              {group.options.map((option) => {
                const label = `${localized(option.names, locale)}${option.deltaFils !== "0" ? ` +${formatFils(option.deltaFils, locale)}` : ""}`;
                return (
                  <Chip
                    key={option.id}
                    testID={`option-${option.id}`}
                    role={group.maxCount === 1 ? "radio" : "checkbox"}
                    label={option.available ? label : `${label} · ${t("branch.soldOut")}`}
                    selected={(selection[group.id] ?? []).includes(option.id)}
                    disabled={!option.available}
                    onPress={() => setSelection(toggleOption(selection, group, option.id))}
                  />
                );
              })}
            </View>
          </View>
        );
      })}

      <Heading level={2}>{t("product.quantity")}</Heading>
      <View style={styles.row}>
        <Button
          label="−"
          hint={t("product.decrease")}
          variant="secondary"
          disabled={quantity <= 1}
          onPress={() => setQuantity(quantity - 1)}
          testID="qty-decrease"
        />
        <Body>{String(quantity)}</Body>
        <Button
          label="+"
          hint={t("product.increase")}
          variant="secondary"
          disabled={quantity >= MAX_ITEM_QUANTITY}
          onPress={() => setQuantity(quantity + 1)}
          testID="qty-increase"
        />
      </View>

      <TextInput
        accessibilityLabel={t("product.notes")}
        accessibilityHint={t("product.notesHint")}
        placeholder={t("product.notes")}
        value={notes}
        maxLength={200}
        onChangeText={setNotes}
        style={{
          minHeight: touchTarget.android,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingHorizontal: space[3],
          backgroundColor: colors.surface,
          color: colors.ink,
          textAlign: "auto",
        }}
      />
      <Body muted>{t("product.notesHint")}</Body>

      {missingGroup ? (
        <Body>{t("product.missing", { group: localized(missingGroup.names, locale) })}</Body>
      ) : null}
      <Button
        testID="add-to-cart"
        label={addLabel}
        disabled={!ready || priced === null}
        onPress={add}
      />
      {product.available ? <GiftButton productId={product.id} /> : null}

      <ConfirmDialog
        visible={pending !== null}
        title={t("switch.title")}
        body={t("switch.body", { branch: conflictBranch })}
        confirmLabel={t("switch.confirm")}
        onConfirm={() => {
          if (pending) replaceCart(pending);
          setPending(null);
          onAdded();
        }}
        onCancel={() => setPending(null)}
      />
    </View>
  );
}

/** Sandbox gift: the customer gets a one-time code to share; nothing is charged. */
function GiftButton({ productId }: { productId: string }) {
  const { t } = useI18n();
  const { signedIn } = useAppState();
  const navigation = useNavigation<NativeStackNavigationProp<RootParams>>();
  const send = useAction(async () => {
    const result = await call(
      api.POST("/v1/gifts", {
        params: { header: { "Idempotency-Key": newIdempotencyKey() } },
        body: { productId },
      }),
    );
    navigation.navigate("Rewards", { sentCode: result.data.claimToken });
  });
  if (!signedIn) return null;
  return (
    <View style={{ gap: 4 }}>
      <Button
        testID="send-gift"
        label={t("gifts.send")}
        variant="secondary"
        disabled={send.pending}
        onPress={() => void send.run()}
      />
      <Body muted>{t("gifts.sendHint")}</Body>
      <FailureText failure={send.failure} />
    </View>
  );
}
