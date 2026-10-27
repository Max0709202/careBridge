import { MailOpen, Mail } from 'lucide-react';
import { useState } from 'react';

import { userIsEmailVerified } from '../domain/models';
import { useApi, useCare } from '../state/context';
import { useFeedback } from './feedback';
import { AppCard, Button } from './ui';

/**
 * Asks the user to confirm their email address, once it matters. Nothing is
 * blocked on verification, but invitations are — and this prompt is the only
 * reason an unverified address ever becomes a verified one. Renders nothing
 * when there is nothing to say. Port of verification_banner.dart.
 */
export function VerificationBanner() {
  const { user } = useCare();
  const api = useApi();
  const { showFailure } = useFeedback();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!user || userIsEmailVerified(user)) return null;

  async function resend(email: string) {
    setSending(true);
    try {
      await api.resendVerification(email);
      setSent(true);
    } catch (error) {
      showFailure(error);
    } finally {
      setSending(false);
    }
  }

  const Icon = sent ? MailOpen : Mail;

  return (
    <AppCard className="mb-md">
      <div className="row start">
        <Icon className="ink-primary" aria-hidden style={{ flex: '0 0 auto' }} />
        <div className="grow">
          <p className="t-title-sm">
            {sent ? 'Check your inbox' : 'Confirm your email address'}
          </p>
          <p className="t-body muted mt-xs">
            {sent
              ? `We sent a new link to ${user.email}. It works once and expires in a day.`
              : 'You can use CareBridge without it, but you cannot invite a relative or accept an invitation until the address is confirmed.'}
          </p>
          {!sent && (
            <Button
              variant="text"
              className="align-start mt-sm"
              disabled={sending}
              onClick={() => resend(user.email)}
            >
              {sending ? 'Sending…' : 'Send the link again'}
            </Button>
          )}
        </div>
      </div>
    </AppCard>
  );
}
