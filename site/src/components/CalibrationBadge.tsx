import type { CalibrationModel } from "../types";

const labels = {
  match: "校准一致",
  mismatch: "存在差异",
  partial: "部分可比",
  missing: "参考缺失",
};

export function CalibrationBadge({
  calibration,
}: {
  calibration: CalibrationModel | undefined;
}) {
  if (!calibration) {
    return <span className="status status-neutral">未校准</span>;
  }
  return (
    <a
      className={`status status-${calibration.status}`}
      href={calibration.referenceUrl}
      target="_blank"
      rel="noreferrer"
    >
      {labels[calibration.status]}
    </a>
  );
}
