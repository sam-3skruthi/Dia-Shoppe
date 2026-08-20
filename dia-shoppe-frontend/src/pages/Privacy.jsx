import LegalPage, { Section, Val } from '../components/LegalPage'
import { business } from '../data/business'

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={`This policy explains what ${business.legalName} collects when you use ${business.website}, why we collect it, and the choices you have. We only collect what is needed to take your order, deliver it, and support you afterwards.`}
    >
      <Section title="Information we collect">
        <p>When you shop with us we collect:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><strong>Contact details</strong> — name, email address and mobile number.</li>
          <li><strong>Delivery address</strong> — so the courier can reach you.</li>
          <li><strong>Order details</strong> — the products you bought, quantities and amounts.</li>
          <li><strong>Account details</strong> — if you create an account, your login email and password (the password is stored only as an encrypted hash; we never see it).</li>
          <li><strong>Usage data</strong> — pages visited and actions taken on the site, used to understand what needs improving.</li>
        </ul>
        <p>
          <strong>We never see or store your card, UPI or bank details.</strong> Payments are handled entirely
          by Razorpay on their own secure systems; we only receive a confirmation that a payment succeeded.
        </p>
      </Section>

      <Section title="How we use it">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>To process, pack and deliver your order.</li>
          <li>To send you order updates by email and WhatsApp (confirmation, dispatch, delivery, cancellation).</li>
          <li>To answer your questions and handle returns or refunds.</li>
          <li>To meet our legal and accounting obligations.</li>
          <li>To send offers — <strong>only if you ticked the marketing box</strong>, and you can stop them at any time.</li>
        </ul>
      </Section>

      <Section title="WhatsApp messages">
        <p>
          Order updates are sent to the mobile number you give at checkout. You can decline these by
          unticking the WhatsApp option during checkout. Marketing messages are sent only to customers who
          separately opted in, and you can withdraw consent at any time by replying <strong>STOP</strong> or
          emailing us.
        </p>
      </Section>

      <Section title="Who we share it with">
        <p>We share only what is necessary, and never sell your data. Our processors are:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><strong>Razorpay</strong> — to take payments and issue refunds.</li>
          <li><strong>Courier partners</strong> — name, address and phone, so your parcel can be delivered.</li>
          <li><strong>Supabase</strong> — secure hosting of our database.</li>
          <li><strong>Resend</strong> — to send order emails.</li>
          <li><strong>Meta (WhatsApp)</strong> — to send order updates to your number.</li>
          <li><strong>PostHog</strong> — anonymous usage analytics.</li>
        </ul>
        <p>We may also disclose information where required by law.</p>
      </Section>

      <Section title="How long we keep it">
        <p>
          Order and invoice records are kept as long as tax and accounting law requires. Account details are
          kept while your account is open. You can ask us to delete your account at any time — we will remove
          your personal details and retain only the transaction records the law requires us to keep.
        </p>
      </Section>

      <Section title="Your rights">
        <p>You can ask us to:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Show you the personal data we hold about you.</li>
          <li>Correct anything that is wrong.</li>
          <li>Delete your account and personal data.</li>
          <li>Stop sending marketing messages.</li>
        </ul>
        <p>
          Email <a href={`mailto:${business.email}`} className="text-primary-700 hover:underline">{business.email}</a> and
          we will respond within 30 days.
        </p>
      </Section>

      <Section title="Security">
        <p>
          The site runs over encrypted HTTPS, passwords are hashed, and access to customer data is limited to
          authorised staff. No system is perfectly secure, but we take these safeguards seriously and will tell
          you promptly if a breach ever affects your data.
        </p>
      </Section>

      <Section title="Children">
        <p>Our store is intended for adults. We do not knowingly collect data from anyone under 18.</p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          If we change this policy we will update the date at the top of this page. Significant changes will be
          announced on the site. This policy is governed by the laws of India, and is operated
          from <Val>{business.address}</Val>.
        </p>
      </Section>
    </LegalPage>
  )
}
