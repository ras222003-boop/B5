import { type ImgHTMLAttributes } from "react";

export const AURUM_NEXUS_LOGO_URL =
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663959901096/bINsnmGGMMYkhyzn.png";

type BrandLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src">;

export default function BrandLogo({
  alt = "شعار Aurum Nexus",
  className = "",
  ...props
}: BrandLogoProps) {
  return (
    <img
      src={AURUM_NEXUS_LOGO_URL}
      alt={alt}
      className={`object-contain bg-black ${className}`}
      decoding="async"
      {...props}
    />
  );
}
