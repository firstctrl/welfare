import { EmailLogClient } from './email-log-client';

export const metadata = { title: 'Email Log - Welfare Department' };

export default function EmailLogPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-neutral-900">Email Log</h1>
      <EmailLogClient />
    </div>
  );
}
