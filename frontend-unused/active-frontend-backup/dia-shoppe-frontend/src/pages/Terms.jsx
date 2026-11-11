import { Link } from 'react-router-dom'
import LegalPage, { Section, Val } from '../components/LegalPage'
import { business } from '../data/business'

export default function Terms() {
  return (
    <LegalPage
      title="Terms & Conditions"
      intro={`These terms govern your use of ${business.website} and any order you place with ${business.legalName}. By placing an order you agree to them.`}
    >
      <Section title="About us">
        <p>
          {business.website} is operated by <strong>{business.legalName}</strong>, a distributor of medical and
          surgical equipment serving customers across India since 2004, at <Val>{business.address}</Val>.
        </p>
      </Section>

      <Section title="Products and medical disclaimer">
        <p>
          We sell genuine medical equipment sourced from authorised brand channels. Product descriptions,
          images and specifications are provided by the manufacturer and are for information only.
        </p>
        <p className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900">
          <strong>Important:</strong> nothing on this site is medical advice. Our products do not diagnose or
          treat any condition on their own, and readings from monitoring devices are not a substitute for
          professional judgement. Always follow the manufacturer's instructions and consult a qualified
          healthcare professional about your treatment. Certain items may require a prescription or
          professional supervision — it is your responsibility to ensure you are permitted to buy and use them.
        </p>
      </Section>

      <Section title="Orders">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Your order is an offer to buy; it is accepted when we confirm it.</li>
          <li>
            We may decline or cancel an order — for example if an item is out of stock, a price was listed in
            error, or we cannot verify the delivery details. If you have already paid, you get a full refund.
          </li>
          <li>Please check your delivery address and phone number carefully; we cannot redirect a dispatched parcel.</li>
        </ul>
      </Section>

      <Section title="Pricing and payment">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>All prices are in Indian Rupees (₹) and include applicable taxes unless stated otherwise.</li>
          <li>Delivery charges, where they apply, are shown before you pay.</li>
          <li>Online payments are processed by Razorpay. Cash on delivery is available on eligible orders.</li>
          <li>
            Prices and offers can change at any time, but a change never affects an order we have already
            confirmed.
          </li>
        </ul>
      </Section>

      <Section title="Delivery, returns and refunds">
        <p>
          Shipping timelines, cancellation rights, returns and refunds are set out in our{' '}
          <Link to="/refunds" className="text-primary-700 hover:underline font-medium">
            Shipping, Returns &amp; Refunds policy
          </Link>
          , which forms part of these terms.
        </p>
      </Section>

      <Section title="Your account">
        <p>
          You are responsible for keeping your login details secure and for activity on your account. Tell us
          immediately if you think someone else has access. We may suspend accounts used for fraudulent or
          abusive activity.
        </p>
      </Section>

      <Section title="Acceptable use">
        <p>
          Do not use this site to break the law, interfere with its operation, attempt unauthorised access, or
          copy our content and branding for commercial use without permission.
        </p>
      </Section>

      <Section title="Reviews">
        <p>
          Customers may review products they have bought. Please keep reviews honest and civil — we may remove
          content that is abusive, misleading, or unrelated to the product.
        </p>
      </Section>

      <Section title="Liability">
        <p>
          We take care to describe products accurately and deliver them in good condition. To the extent
          permitted by law, our liability for any order is limited to the amount you paid for it. Nothing in
          these terms limits liability for death or personal injury caused by our negligence, or for fraud.
        </p>
      </Section>

      <Section title="Privacy">
        <p>
          How we handle your personal information is explained in our{' '}
          <Link to="/privacy" className="text-primary-700 hover:underline font-medium">Privacy Policy</Link>.
        </p>
      </Section>

      <Section title="Governing law">
        <p>
          These terms are governed by the laws of India, and disputes are subject to the exclusive jurisdiction
          of the courts where our registered office is located.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          We may update these terms; the version shown here at the time you order is the one that applies to
          that order.
        </p>
      </Section>
    </LegalPage>
  )
}
