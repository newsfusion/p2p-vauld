interface BrandBannerProps {
  className?: string;
  imageClassName?: string;
}

export function BrandBanner({
  className = "",
  imageClassName = "h-10 w-auto",
}: BrandBannerProps) {
  return (
    <div className={["flex min-w-0 items-center", className].filter(Boolean).join(" ")}>
      <img
        src="/vauld-banner.png"
        alt=""
        aria-hidden="true"
        className={["brand-banner-light block shrink-0 object-contain", imageClassName]
          .filter(Boolean)
          .join(" ")}
      />
      <img
        src="/vauld-banner-dark.png"
        alt=""
        aria-hidden="true"
        className={["brand-banner-dark shrink-0 object-contain", imageClassName]
          .filter(Boolean)
          .join(" ")}
      />
      <span className="sr-only">P2P Portfolio Tracker</span>
    </div>
  );
}
