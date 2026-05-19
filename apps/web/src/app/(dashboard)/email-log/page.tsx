import { EmailLogClient } from './email-log-client';

export const metadata = { title: 'Email Log — Welfare' };

export default function EmailLogPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Email Log</h1>
      <EmailLogClient />
    </div>
  );
}
