import "./globals.css";

export const metadata = {
  title: "SNAP-GA — Georgia SNAP eligibility explainer",
  description:
    "A plain-language SNAP eligibility explainer for Georgia. Not a formal determination.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
