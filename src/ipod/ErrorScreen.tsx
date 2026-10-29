import sadIpod from "./assets/sad-ipod.svg?raw";

export function ErrorScreen({ message }: { message: string }) {
  return (
    <>
      <div className="ipod-overlay-screen" data-testid="ipod-error-screen" aria-hidden="true">
        <div className="sad-ipod-container" dangerouslySetInnerHTML={{ __html: sadIpod }} />
        <p className="error-message">{message}</p>
      </div>
      <span className="visually-hidden" role="status">{message}</span>
    </>
  );
}
