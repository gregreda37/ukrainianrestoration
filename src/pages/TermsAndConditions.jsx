import { Link } from 'react-router-dom'

const EFFECTIVE = 'June 1, 2026'
const COMPANY   = 'Ukrainian Restoration LLC'
const PHONE     = '(973) 219-4973'
const EMAIL     = 'info@ukrainianrestoration.com'
const LICENSE   = 'NJ.LIC #13VH10509300'

export default function TermsAndConditions() {
  return (
    <>
      <div className="page-banner">
        <div className="container">
          <p className="legal-eyebrow">Legal</p>
          <h1>Terms &amp; Conditions</h1>
          <p>Effective {EFFECTIVE} · {COMPANY}</p>
        </div>
      </div>

      <section className="section">
        <div className="container">
          <div className="legal-body">

            <p className="legal-intro">
              These Terms and Conditions ("Terms") govern all services provided by{' '}
              <strong>{COMPANY}</strong> ("Company", "we", "us") to our clients ("you").
              By requesting, scheduling, or accepting any service from us, you agree to
              be bound by these Terms.
            </p>

            <div className="legal-section">
              <h2>1. Services</h2>
              <p>
                Ukrainian Restoration LLC provides residential and commercial construction,
                restoration, renovation, water damage recovery, and related contracting
                services throughout New Jersey and surrounding areas. We hold New Jersey
                Home Improvement Contractor License {LICENSE}.
              </p>
              <p>
                All work is performed in accordance with applicable New Jersey building
                codes, OSHA safety standards, and industry best practices. The specific
                scope of services for each project is defined in a written estimate or
                contract provided prior to commencement of work.
              </p>
            </div>

            <div className="legal-section">
              <h2>2. Estimates and Contracts</h2>
              <p>
                Written estimates are provided free of charge and are valid for 30 days
                from the date issued unless otherwise specified. An estimate does not
                constitute a binding contract. Work begins only after a signed written
                agreement and any required deposit have been received.
              </p>
              <p>
                All contracts detail the scope of work, materials to be used, project
                timeline, and total cost. Changes to the agreed scope must be documented
                through a written Change Order signed by both parties before additional
                work begins.
              </p>
            </div>

            <div className="legal-section">
              <h2>3. Payment Terms</h2>
              <p>
                Payment schedules are outlined in each project contract. Typical terms
                require a deposit of 30–50% at contract signing, progress payments at
                agreed milestones, and a final payment upon substantial completion.
              </p>
              <p>
                Payments are due within 5 business days of the invoice date unless
                otherwise agreed in writing. Overdue balances accrue interest at 1.5%
                per month. The Company reserves the right to suspend work on projects
                with outstanding balances until payment is received.
              </p>
              <p>
                We accept cash, check, ACH bank transfer, and major credit cards. A 3%
                processing fee applies to credit card payments.
              </p>
            </div>

            <div className="legal-section">
              <h2>4. Change Orders</h2>
              <p>
                Any change to the agreed scope of work — including additions, deletions,
                or substitutions — must be documented in a signed Change Order before
                execution. Change Orders may adjust the contract price, project timeline,
                or both. Verbal authorizations do not constitute a valid Change Order.
              </p>
              <p>
                Unforeseen site conditions (e.g., hidden mold, deteriorated structural
                members, code-required upgrades discovered during work) that could not
                reasonably be anticipated during the estimate process may require a
                Change Order to address. We will notify you promptly and provide a
                written cost estimate before proceeding.
              </p>
            </div>

            <div className="legal-section">
              <h2>5. Project Timeline</h2>
              <p>
                Project timelines are estimates and are subject to change due to weather
                delays, material availability, permit processing times, unforeseen site
                conditions, or change order additions. We will communicate schedule
                changes promptly. Delays beyond our reasonable control do not constitute
                a breach of contract.
              </p>
            </div>

            <div className="legal-section">
              <h2>6. Client Responsibilities</h2>
              <p>You agree to:</p>
              <ul className="legal-list">
                <li>Provide clear access to the work area during scheduled work hours</li>
                <li>Remove personal property, valuables, and fragile items from work areas before work begins</li>
                <li>Secure pets away from work areas for the safety of your animals and our crew</li>
                <li>Obtain necessary homeowner association approvals if applicable</li>
                <li>Disclose known site hazards (e.g., asbestos, lead paint, structural concerns)</li>
                <li>Make payments on the agreed schedule</li>
              </ul>
            </div>

            <div className="legal-section">
              <h2>7. Materials and Substitutions</h2>
              <p>
                Unless materials are explicitly specified in the contract, we reserve the
                right to select materials of equivalent quality and value. We will notify
                you of any material substitutions due to availability. Client-supplied
                materials are installed at the client's risk; we are not responsible for
                defects in materials we did not procure.
              </p>
            </div>

            <div className="legal-section">
              <h2>8. Permits</h2>
              <p>
                Where required, we will obtain permits on your behalf as part of the
                contracted scope. Permit fees are passed through at cost and itemized
                separately. Work requiring inspections will not be closed until the
                required inspections have been passed. You are responsible for maintaining
                permits and providing access to inspectors during business hours.
              </p>
            </div>

            <div className="legal-section">
              <h2>9. Warranty</h2>
              <p>
                We warrant our workmanship against defects in construction for a period
                of <strong>one (1) year</strong> from the date of substantial completion.
                This warranty covers defects arising from our installation practices and
                does not cover:
              </p>
              <ul className="legal-list">
                <li>Normal wear and tear</li>
                <li>Damage caused by misuse, neglect, or modification by others</li>
                <li>Damage from events outside our control (floods, storms, settling)</li>
                <li>Manufacturer defects in materials (covered by manufacturer warranties)</li>
              </ul>
              <p>
                Warranty claims must be submitted in writing within the warranty period.
                We will inspect and, if warranted, repair defective workmanship at no
                additional charge.
              </p>
            </div>

            <div className="legal-section">
              <h2>10. Limitation of Liability</h2>
              <p>
                To the maximum extent permitted by New Jersey law, our total liability for
                any claim arising from our services shall not exceed the total amount paid
                by you under the applicable contract. We are not liable for indirect,
                incidental, consequential, or punitive damages, including loss of use,
                loss of income, or cost of alternative accommodations during the project.
              </p>
              <p>
                We carry general liability insurance and workers' compensation insurance
                as required by New Jersey law. Certificates of insurance are available
                upon request.
              </p>
            </div>

            <div className="legal-section">
              <h2>11. Cancellation and Termination</h2>
              <p>
                Either party may terminate a contract by providing written notice. If you
                cancel after signing but before work begins, you forfeit the deposit to
                cover administrative, scheduling, and material procurement costs already
                incurred. If you cancel after work has begun, you are responsible for
                the fair value of all work completed and materials purchased or ordered
                to that point, plus any reasonable demobilization costs.
              </p>
              <p>
                We reserve the right to terminate a contract if you fail to make required
                payments, obstruct progress, or create unsafe working conditions. In such
                cases, we are entitled to payment for all work completed.
              </p>
            </div>

            <div className="legal-section">
              <h2>12. Photographs and Marketing</h2>
              <p>
                We may photograph work in progress and completed projects for portfolio,
                social media, and marketing purposes. Images will not include identifying
                information about your property or family. If you prefer that we not
                photograph your project, please notify us in writing before work begins.
              </p>
            </div>

            <div className="legal-section">
              <h2>13. Client Portal (MyClaim)</h2>
              <p>
                We offer an optional online client portal ("MyClaim") for tracking your
                project. Use of the portal is governed by these Terms and our{' '}
                <Link to="/privacy">Privacy Policy</Link>. Portal access is provided
                solely for your use; you may not share your credentials with others.
                You are responsible for maintaining the security of your login information.
              </p>
            </div>

            <div className="legal-section">
              <h2>14. Governing Law and Disputes</h2>
              <p>
                These Terms are governed by the laws of the State of New Jersey. Any
                disputes arising from our services shall first be addressed through
                good-faith negotiation. If unresolved within 30 days, disputes may be
                submitted to mediation through a mutually agreed mediator before pursuing
                litigation. Venue for any legal proceedings shall be in the appropriate
                court of New Jersey.
              </p>
            </div>

            <div className="legal-section">
              <h2>15. Entire Agreement</h2>
              <p>
                These Terms, together with your signed project contract, constitute the
                entire agreement between you and Ukrainian Restoration LLC regarding our
                services and supersede all prior discussions, representations, or
                agreements. If any provision of these Terms is found unenforceable, the
                remaining provisions continue in full force.
              </p>
            </div>

            <div className="legal-section">
              <h2>16. Contact</h2>
              <p>Questions about these Terms? Reach us at:</p>
              <ul className="legal-list">
                <li><strong>Phone:</strong> <a href="tel:+19732194973">{PHONE}</a></li>
                <li><strong>Email:</strong> <a href={`mailto:${EMAIL}`}>{EMAIL}</a></li>
                <li><strong>License:</strong> {LICENSE}</li>
              </ul>
            </div>

            <p className="legal-updated">Last updated: {EFFECTIVE}</p>
          </div>
        </div>
      </section>
    </>
  )
}
