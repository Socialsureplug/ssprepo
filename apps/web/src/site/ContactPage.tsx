import { useState } from 'react';
import { Mail, MessageSquare } from 'lucide-react';
import { BRAND } from '@app/shared';
import { Button, Field, Input, Textarea, Select, Alert } from '@app/ui';
import { PageHero, Section } from './parts';

/**
 * Contact form opens the user's email client with a pre-filled message. A CRM or ticketing
 * integration can replace `mailto:` without changing the page.
 */
export default function ContactPage() {
  const [sent, setSent] = useState(false);
  return (
    <>
      <PageHero eyebrow="Contact" title="Talk to our team." description="Questions about integration, pricing or going live? We'll get back to you within one business day." />
      <Section>
        <div className="grid gap-12 lg:grid-cols-[1fr_1.3fr]">
          <div className="space-y-8">
            <div className="flex gap-4">
              <Mail className="mt-1 h-5 w-5 text-primary" />
              <div><div className="font-semibold text-ink">Support</div><a className="text-[15px] text-primary" href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a></div>
            </div>
            <div className="flex gap-4">
              <MessageSquare className="mt-1 h-5 w-5 text-primary" />
              <div><div className="font-semibold text-ink">Existing merchants</div><p className="text-[15px] text-muted">Include your payment reference or API request ID so we can help faster.</p></div>
            </div>
          </div>
          <form
            className="space-y-4 rounded-lg border border-line p-6 sm:p-8"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const body = `Name: ${f.get('name')}\nCompany: ${f.get('company')}\nTopic: ${f.get('topic')}\n\n${f.get('message')}`;
              window.location.href = `mailto:${BRAND.supportEmail}?subject=${encodeURIComponent(`[${f.get('topic')}] ${f.get('company')}`)}&body=${encodeURIComponent(body)}`;
              setSent(true);
            }}
          >
            {sent && <Alert tone="success" title="Your email app should now be open">If it didn't open, email us directly at {BRAND.supportEmail}.</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="name"><Input id="name" name="name" required autoComplete="name" /></Field>
              <Field label="Company" htmlFor="company"><Input id="company" name="company" required autoComplete="organization" /></Field>
            </div>
            <Field label="Topic" htmlFor="topic">
              <Select id="topic" name="topic" defaultValue="Sales">
                <option>Sales</option><option>Integration support</option><option>Going live</option><option>Something else</option>
              </Select>
            </Field>
            <Field label="Message" htmlFor="message"><Textarea id="message" name="message" required rows={5} /></Field>
            <Button type="submit" className="w-full sm:w-auto">Send message</Button>
          </form>
        </div>
      </Section>
    </>
  );
}
