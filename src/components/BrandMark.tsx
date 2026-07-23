import { Crown } from "lucide-react";

interface BrandMarkProps {
  compact?: boolean;
}

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <div className="brand-mark" aria-label="Return of the King">
      <span className="brand-mark__crown" aria-hidden="true">
        <Crown size={20} strokeWidth={2.35} />
      </span>
      {!compact && (
        <div className="brand-mark__type">
          <span>RETURN OF THE</span>
          <strong>KING</strong>
        </div>
      )}
    </div>
  );
}
