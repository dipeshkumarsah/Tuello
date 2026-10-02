'use client';

import { EmailRequestForm } from '@/components/email-request-form';

export default function ForgotPasswordPage() {
  return <EmailRequestForm kind="reset" />;
}
