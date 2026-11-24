export function Icon({ paths }: { paths: string[] }) {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {paths.filter(Boolean).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
