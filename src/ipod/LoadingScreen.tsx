import appleLogo from "./assets/apple-logo.svg?raw";

export function LoadingScreen() {
  return (
    <>
      <div
        className="loading-screen"
        data-testid="ipod-loading-screen"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: appleLogo }}
      />
      <span className="visually-hidden" role="status">Loading</span>
    </>
  );
}
