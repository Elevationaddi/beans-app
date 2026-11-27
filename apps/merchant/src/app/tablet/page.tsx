import type { Metadata } from "next";
import { APP_SURFACES } from "@beans/contracts";

export const metadata: Metadata = {
  title: "Branch tablet (development)",
};

// Route reserved for the barista order queue (docs/05-barista-interface.md, phase 8).
export default function TabletPage() {
  return (
    <main>
      <div className="card">
        <h1>{APP_SURFACES.tablet.title}</h1>
        <p>The order queue is not built yet. No orders are received here.</p>
      </div>
    </main>
  );
}
