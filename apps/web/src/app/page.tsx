import { parseWebEnvironment } from "@repairflow/config";

const environment = parseWebEnvironment(process.env);

const foundations = [
  ["Web", "Next.js staff dashboard and customer portal"],
  ["API", "NestJS modular monolith with request tracing"],
  ["Worker", "Background jobs, notifications, and AI tasks"],
  ["Data", "PostgreSQL, Prisma, and private object storage"],
] as const;

export default function Home() {
  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Milestone 1 · Foundation</p>
        <h1>RepairFlow</h1>
        <p className="lead">
          Nền tảng vận hành cửa hàng sửa điện thoại, laptop và tablet từ tiếp nhận đến bảo hành.
        </p>
        <span className="status">Foundation ready</span>
      </section>

      <section className="grid" aria-label="System foundations">
        {foundations.map(([title, description]) => (
          <article key={title}>
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>

      <footer>
        API contract: <code>{environment.NEXT_PUBLIC_API_URL}</code>
      </footer>
    </main>
  );
}
