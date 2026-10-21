export default function BrandMark({ size = 24 }: { size?: number }) {
  const gradId = "agy-grad-" + size;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="brand-sparkle"
    >
      <defs>
        <linearGradient
          id={gradId}
          x1="2"
          y1="2"
          x2="22"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="48%" stopColor="#9B72CF" />
          <stop offset="100%" stopColor="#D96570" />
        </linearGradient>
      </defs>
      {/* Primary 4-point Antigravity Star */}
      <path
        d="M12 2C12 7.523 7.523 12 2 12C7.523 12 12 16.477 12 22C12 16.477 16.477 12 22 12C16.477 12 12 7.523 12 2Z"
        fill={`url(#${gradId})`}
      />
      {/* Secondary Companion Sparkle */}
      <path
        d="M19 2C19 3.657 17.657 5 16 5C17.657 5 19 6.343 19 8C19 6.343 20.343 5 22 5C20.343 5 19 3.657 19 2Z"
        fill={`url(#${gradId})`}
        opacity="0.85"
      />
      {/* Orbital accent ring */}
      <circle
        cx="12"
        cy="12"
        r="9.5"
        stroke={`url(#${gradId})`}
        strokeWidth="1.2"
        strokeDasharray="2 3"
        opacity="0.35"
      />
    </svg>
  );
}
