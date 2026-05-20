import type { ReactNode } from "react";

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {children ? <div className="page-actions">{children}</div> : null}
    </div>
  );
}
