import { citySchema, type City } from "@beans/contracts";
import { useState } from "react";
import { View } from "react-native";
import {
  Body,
  Button,
  Chip,
  FailureText,
  Field,
  Heading,
  RemoteState,
  Screen,
  styles,
} from "../components/ui";
import { useI18n } from "../i18n";
import { api, call } from "../lib/api";
import { useAction } from "../lib/use-action";
import { useRemote } from "../lib/use-remote";

/** C11: saved vehicles for curbside pickup. Staff see only colour, model and plate. */
export function VehiclesScreen() {
  const { t } = useI18n();
  const [plate, setPlate] = useState("");
  const [color, setColor] = useState("");
  const [model, setModel] = useState("");
  const [region, setRegion] = useState<City>("abu_dhabi");
  const vehicles = useRemote(async () => (await call(api.GET("/v1/vehicles"))).data, []);
  const add = useAction(async () => {
    await call(
      api.POST("/v1/vehicles", {
        body: {
          plate: plate.trim(),
          color: color.trim(),
          plateRegion: region,
          ...(model.trim() && { model: model.trim() }),
        },
      }),
    );
    setPlate("");
    setColor("");
    setModel("");
    vehicles.reload();
  });
  const remove = useAction(async (id: string) => {
    await call(api.DELETE("/v1/vehicles/{id}", { params: { path: { id } } }));
    vehicles.reload();
  });
  const plateValid = /^[A-Za-z0-9 ]{1,12}$/.test(plate.trim());
  return (
    <Screen testID="vehicles">
      <Heading>{t("vehicles.title")}</Heading>
      <Body muted>{t("vehicles.privacy")}</Body>
      <RemoteState
        remote={vehicles}
        isEmpty={(l) => l.length === 0}
        empty={<Body>{t("vehicles.none")}</Body>}
      >
        {(list) => (
          <View style={{ gap: 8 }}>
            {list.map((v) => (
              <View key={v.id} style={styles.card}>
                <Body>{[v.color, v.model, v.plate].filter(Boolean).join(" · ")}</Body>
                {v.plateRegion ? <Body muted>{t(`city.${v.plateRegion}`)}</Body> : null}
                <Button
                  label={t("vehicles.remove", { plate: v.plate })}
                  variant="secondary"
                  onPress={() => void remove.run(v.id)}
                  disabled={remove.pending}
                />
              </View>
            ))}
          </View>
        )}
      </RemoteState>
      <FailureText failure={remove.failure} />
      <View style={styles.card}>
        <Heading level={2}>{t("vehicles.add")}</Heading>
        <Field
          label={t("vehicles.plate")}
          value={plate}
          onChangeText={setPlate}
          autoCapitalize="characters"
          maxLength={12}
          testID="vehicle-plate"
        />
        <Body muted>{t("vehicles.region")}</Body>
        <View style={styles.row} accessibilityRole="radiogroup">
          {citySchema.options.map((c) => (
            <Chip
              key={c}
              role="radio"
              label={t(`city.${c}`)}
              selected={region === c}
              onPress={() => setRegion(c)}
            />
          ))}
        </View>
        <Field
          label={t("vehicles.color")}
          value={color}
          onChangeText={setColor}
          maxLength={30}
          testID="vehicle-color"
        />
        <Field label={t("vehicles.model")} value={model} onChangeText={setModel} maxLength={60} />
        <Button
          label={t("vehicles.save")}
          onPress={() => void add.run()}
          disabled={add.pending || !plateValid || !color.trim()}
          testID="vehicle-save"
        />
        <FailureText failure={add.failure} />
      </View>
    </Screen>
  );
}
