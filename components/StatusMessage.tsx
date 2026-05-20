export function StatusMessage({ issues }: { issues: string[] }) {
  if (!issues.length) {
    return null;
  }

  return (
    <section className="notice">
      <strong>Data kunne ikke læses fra alle tabeller.</strong>
      <ul>
        {issues.map((issue, index) => (
          <li key={`${index}-${issue}`}>{issue}</li>
        ))}
      </ul>
    </section>
  );
}
