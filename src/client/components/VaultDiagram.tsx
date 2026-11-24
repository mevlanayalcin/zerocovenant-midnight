import React from "react";

interface VaultDiagramProps {
  labels: [string, string, string, string];
  balancesUsd: [string, string, string, string];
  maxCapBps: string;
}

function formatCompactUsd(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}k`;
  return `$${val.toFixed(0)}`;
}

export const VaultDiagram: React.FC<VaultDiagramProps> = ({
  labels,
  balancesUsd,
  maxCapBps
}) => {
  const nums = balancesUsd.map((b) => Number(b) || 0);
  const total = nums.reduce((acc, n) => acc + n, 0);
  const capPct = (Number(maxCapBps) || 4000) / 100;
  const maxPctScale = Math.max(60, Math.ceil(Math.max(...nums.map((n) => (total > 0 ? (n / total) * 100 : 0)), capPct) / 10) * 10 + 5);

  return (
    <div className="rounded-xl border border-slate-800/90 bg-[#0b101b] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Private Custodian Concentration vs On-Chain Cap
          </h4>
          <p className="text-[11px] text-slate-500">
            Every custodian share is checked inside ZK against the {capPct.toFixed(2)}% covenant limit — raw balances never leave the prover.
          </p>
        </div>
        <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-0.5 font-mono text-[11px] text-indigo-300">
          Cap ≤ {capPct.toFixed(2)}%
        </span>
      </div>

      <svg
        viewBox="0 0 640 190"
        className="w-full select-none overflow-visible"
        role="img"
        aria-label="Private custodian concentration chart"
      >
        {/* Cap vertical guideline */}
        {(() => {
          const chartLeft = 175;
          const chartWidth = 420;
          const capX = chartLeft + (capPct / maxPctScale) * chartWidth;
          return (
            <g>
              <line
                x1={capX}
                y1={8}
                x2={capX}
                y2={156}
                stroke="#f43f5e"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
              <text
                x={Math.min(capX + 4, 545)}
                y={16}
                fill="#fb7185"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                {capPct.toFixed(1)}% cap
              </text>
            </g>
          );
        })()}

        {nums.map((amt, i) => {
          const sharePct = total > 0 ? (amt / total) * 100 : 0;
          const breached = sharePct > capPct + 1e-9;
          const y = 26 + i * 33;
          const chartLeft = 175;
          const chartWidth = 420;
          const barW = Math.max(2, (sharePct / maxPctScale) * chartWidth);

          return (
            <g key={labels[i]}>
              <text
                x={8}
                y={y + 14}
                fill="#cbd5e1"
                fontSize="11"
                fontFamily="Inter, sans-serif"
                fontWeight="500"
              >
                {labels[i]}
              </text>
              <rect
                x={chartLeft}
                y={y + 2}
                width={chartWidth}
                height={18}
                rx={4}
                fill="#111827"
                stroke="#1e293b"
              />
              <rect
                x={chartLeft}
                y={y + 2}
                width={Math.min(barW, chartWidth)}
                height={18}
                rx={4}
                fill={breached ? "#e11d48" : "#6366f1"}
                fillOpacity={0.88}
              />
              <text
                x={chartLeft + Math.min(barW, chartWidth - 95) + 6}
                y={y + 15}
                fill={breached ? "#fda4af" : "#e2e8f0"}
                fontSize="10.5"
                fontFamily="JetBrains Mono, monospace"
              >
                {sharePct.toFixed(1)}% ({formatCompactUsd(amt)})
              </text>
            </g>
          );
        })}

        {/* Axis legend */}
        <line x1={175} y1={162} x2={595} y2={162} stroke="#334155" strokeWidth="1" />
        {[0, 20, 40, 60].map((tick) => {
          if (tick > maxPctScale) return null;
          const x = 175 + (tick / maxPctScale) * 420;
          return (
            <g key={tick}>
              <line x1={x} y1={162} x2={x} y2={167} stroke="#475569" strokeWidth="1" />
              <text
                x={x - 10}
                y={180}
                fill="#64748b"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                {tick}%
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
