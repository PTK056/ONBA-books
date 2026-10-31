// Logos of the services Splyce connects to, drawn inline (no network request, crisp at any size).

type P = { className?: string };

export function GmailLogo({ className }: P) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75V40h7a3 3 0 0 0 3-3V16.2z" />
      <path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6a3 3 0 0 1-3-3V16.2z" />
      <path fill="#e53935" d="M35 11.2 24 19.45 13 11.2 12 17l1 6.7 11 8.25 11-8.25L36 17z" />
      <path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859A4.3 4.3 0 0 0 7.298 8 4.3 4.3 0 0 0 3 12.298z" />
      <path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341A4.3 4.3 0 0 1 40.702 8 4.3 4.3 0 0 1 45 12.298z" />
    </svg>
  );
}

export function TelegramLogo({ className }: P) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <circle cx="24" cy="24" r="20" fill="#29b6f6" />
      <path fill="#fff" d="M33.95 15l-3.746 19.126S30.043 35 28.959 35c-.576 0-.873-.274-.873-.274l-8.114-6.733-3.97-2.001-5.095-1.355S10 24.375 10 23.625c0-.625.933-.923.933-.923l21.316-8.468S32.9 14 33.375 14c.292 0 .625.125.625.5 0 .25-.05.5-.05.5z" />
      <path fill="#b0bec5" d="M23 30.505l-3.426 3.374s-.149.115-.348.12a.5.5 0 0 1-.219-.042l.964-5.965L23 30.505z" />
      <path fill="#cfd8dc" d="M29.897 18.196a.5.5 0 0 0-.703-.093L16 26s2.106 5.892 2.427 6.912c.322 1.021.58 1.045.58 1.045l.964-5.965 9.832-9.096a.5.5 0 0 0 .094-.7z" />
    </svg>
  );
}

export function WhatsAppLogo({ className }: P) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path fill="#25d366" d="M24 4C13 4 4 12.9 4 23.9c0 3.9 1.1 7.5 3.1 10.6L4.4 44l9.8-2.6A20 20 0 0 0 24 43.9c11 0 20-8.9 20-20S35 4 24 4z" />
      <path fill="#fff" d="M18.6 14.6c-.4-1-.9-1-1.3-1h-1.1c-.4 0-1 .1-1.5.7s-2 1.9-2 4.7 2 5.4 2.3 5.8c.3.4 3.9 6.2 9.6 8.4 4.7 1.9 5.7 1.5 6.7 1.4s3.3-1.3 3.7-2.6.5-2.4.3-2.6c-.1-.2-.5-.4-1-.6l-3.4-1.6c-.5-.2-.8-.3-1.1.2s-1.3 1.6-1.6 2-.6.4-1.1.1a13.6 13.6 0 0 1-6.7-5.9c-.5-.9.5-.8 1.5-2.7.2-.3.1-.6 0-.9l-1.4-3.4z" />
    </svg>
  );
}

export function OutlookLogo({ className }: P) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path fill="#1976d2" d="M28 13h14.5a1.5 1.5 0 0 1 1.5 1.5v19a1.5 1.5 0 0 1-1.5 1.5H28V13z" />
      <path fill="#fff" d="M28 17.3h14v13.4H28z" />
      <path fill="#1976d2" d="M27 44 4 39.5v-31L27 4z" />
      <path fill="#fff" d="M15.25 16.5c-3.17 0-5.75 3.36-5.75 7.5s2.58 7.5 5.75 7.5S21 28.14 21 24s-2.58-7.5-5.75-7.5zm-.25 12.5c-1.66 0-3-2.24-3-5s1.34-5 3-5 3 2.24 3 5-1.34 5-3 5z" />
      <path fill="#1976d2" d="M29.5 21l5.5 4 6-4.5v-2.5l-6 4.5-5.5-4z" />
    </svg>
  );
}

export function BookingLogo({ className }: P) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <rect width="40" height="40" x="4" y="4" rx="8" fill="#003580" />
      <path fill="#fff" d="M15 13h7.6c3.8 0 6 1.8 6 4.7 0 2-1.2 3.4-2.9 3.9 2.3.4 3.7 2 3.7 4.3 0 3.3-2.4 5.1-6.6 5.1H15V13zm4.3 7.5h2.6c1.6 0 2.5-.7 2.5-2s-.9-2-2.5-2h-2.6v4zm0 7.6h3c1.8 0 2.8-.8 2.8-2.3s-1-2.2-2.8-2.2h-3v4.5z" />
      <circle cx="33.5" cy="29" r="2.5" fill="#00a2ff" />
    </svg>
  );
}
