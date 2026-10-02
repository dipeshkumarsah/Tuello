export default function ApexLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg-subtle px-4 py-12">
      {children}
    </div>
  );
}
