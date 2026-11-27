import Link from "next/link";
import { APP_SURFACES } from "@beans/contracts";

export default function Home() {
  return (
    <main>
      <div className="card">
        <h1>{APP_SURFACES.merchant.title}</h1>
        <p>
          Foundation build. Sign-in, onboarding, menus and finance are not built yet, so nothing on
          this site is live.
        </p>
        <p>
          <Link href="/tablet">Open the branch tablet screen</Link>
        </p>
      </div>
    </main>
  );
}
