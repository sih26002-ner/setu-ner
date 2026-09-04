import "./globals.css";

export const metadata = {
  title: "SETU-NER | Smart Logistics Intelligence Platform",
  description:
    "AI-Based Smart Logistics and Accessibility Intelligence Platform for North Eastern Region",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-gray-950 antialiased">
        {children}
      </body>
    </html>
  );
}