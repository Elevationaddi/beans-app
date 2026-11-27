import { APP_SURFACES } from "@beans/contracts";

export default function Home() {
  return (
    <main>
      <div className="card">
        <h1>{APP_SURFACES.admin.title}</h1>
        <p>
          Foundation build. Admin sign-in with multi-factor authentication, merchant review and
          financial controls are not built yet, so nothing on this site is live.
        </p>
      </div>
    </main>
  );
}
