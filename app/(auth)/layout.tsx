export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar px-4">
      <div className="w-full max-w-[400px] rounded-lg border border-border bg-background p-8">
        <p className="mb-6 text-[15px] font-bold tracking-tight">Visus Publish</p>
        {children}
      </div>
    </main>
  );
}
