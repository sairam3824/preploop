"use client";

export function StatsStrip({
  items
}: {
  items: Array<{
    label: string;
    value: string | number;
    highlight?: boolean;
  }>;
}) {
  return (
    <div className="stats-strip">
      {items.map((item) => (
        <div key={item.label} className={item.highlight ? "stat highlight" : "stat"}>
          <div className="label">{item.label}</div>
          <div className="value">{item.value}</div>
        </div>
      ))}
    </div>
  );
}
