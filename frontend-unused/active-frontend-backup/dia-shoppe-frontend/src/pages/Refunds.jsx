import LegalPage, { Section } from '../components/LegalPage'
import { business } from '../data/business'

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN')

export default function Refunds() {
  return (
    <LegalPage
      title="Shipping, Returns & Refunds"
      intro={`We want you to receive exactly what you ordered, in good condition. This page explains how we ship, when you can return something, and how refunds are paid back.`}
    >
      <Section title="Shipping">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Orders are dispatched within <strong>{business.dispatchTime}</strong> of confirmation.</li>
          <li>Delivery usually takes <strong>{business.deliveryTime}</strong> depending on your location.</li>
          <li>
            Delivery is <strong>free on orders over {inr(business.freeShippingOver)}</strong>. Below that a flat
            fee of {inr(business.shippingFee)} applies, shown before you pay.
          </li>
          <li>We deliver across India through our courier partners.</li>
          <li>Once dispatched you receive the courier name and tracking number by WhatsApp and email.</li>
        </ul>
      </Section>

      <Section title="Cancelling an order">
        <p>
          You can cancel from <strong>My Orders</strong> at any time <strong>before the parcel is dispatched</strong> —
          no reason needed beyond telling us why so we can improve. Once an order has shipped it can no longer be
          cancelled, but it may be eligible for return below.
        </p>
      </Section>

      <Section title="Returns">
        <p>
          You may request a return within <strong>{business.returnWindowDays} days</strong> of delivery if the item is:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Damaged, defective or not working.</li>
          <li>Not what you ordered.</li>
          <li>Missing parts or accessories listed on the product page.</li>
        </ul>
        <p>
          The item must be unused, in its original packaging, with all seals, manuals, accessories and the
          invoice. Please photograph the parcel and item before returning — it makes the claim much faster.
        </p>
      </Section>

      <Section title="What cannot be returned">
        <p>
          For hygiene and patient-safety reasons, some medical items cannot be returned once the seal is broken.
          These include test strips, lancets, sterile consumables, and any single-use or personal-care item.
          This does not affect your rights if the product arrived damaged or faulty.
        </p>
      </Section>

      <Section title="How to start a return">
        <p>
          Email <a href={`mailto:${business.email}`} className="text-primary-700 hover:underline">{business.email}</a> with
          your order number and photographs of the item. We will confirm whether it qualifies and arrange
          collection or give you a return address.
        </p>
      </Section>

      <Section title="Refunds">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>Cancelled before dispatch</strong> — if you paid online, the refund is issued automatically
            to your original payment method.
          </li>
          <li>
            <strong>Approved returns</strong> — refunded once we receive and inspect the item.
          </li>
          <li>
            Refunds reach your account in <strong>{business.refundProcessingDays}</strong> after they are issued;
            the exact timing depends on your bank or card provider.
          </li>
          <li>
            <strong>Cash-on-delivery orders</strong> are refunded by bank transfer — we will ask for your account
            details when the return is approved.
          </li>
          <li>Delivery charges are refunded only when the return is due to our error.</li>
        </ul>
      </Section>

      <Section title="Damaged or wrong item delivered">
        <p>
          Tell us within <strong>48 hours</strong> of delivery with photographs. We will replace the item or refund
          you in full, including any delivery charge, at no cost to you.
        </p>
      </Section>

      <Section title="Warranty">
        <p>
          Manufacturer warranties are handled by the brand's own service network. We will help you with the
          paperwork and point you to the right service centre — keep your invoice and warranty card safe.
        </p>
      </Section>
    </LegalPage>
  )
}
