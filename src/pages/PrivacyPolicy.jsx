import { Link } from 'react-router-dom'

const EFFECTIVE = 'June 1, 2026'
const COMPANY   = 'Ukrainian Restoration LLC'
const PHONE     = '(973) 219-4973'
const EMAIL     = 'info@ukrainianrestoration.com'

export default function PrivacyPolicy() {
  return (
    <>
      <div className="page-banner">
        <div className="container">
          <p className="legal-eyebrow">Legal</p>
          <h1>Privacy Policy</h1>
          <p>Effective {EFFECTIVE} · {COMPANY}</p>
        </div>
      </div>

      <section className="section">
        <div className="container">
          <div className="legal-body">

            <p className="legal-intro">
              <strong>{COMPANY}</strong> ("we", "us", "our") respects your privacy and is
              committed to protecting the personal information you share with us. This
              Privacy Policy explains what information we collect, how we use it, and your
              rights regarding your data.
            </p>

            <div className="legal-section">
              <h2>1. Information We Collect</h2>

              <h3>Information you provide directly</h3>
              <ul className="legal-list">
                <li><strong>Contact information</strong> — name, phone number, email address, and mailing/property address submitted through our website contact form, estimate requests, or client portal</li>
                <li><strong>Project details</strong> — description of work requested, photos, insurance claim information, and related documents you upload</li>
                <li><strong>Payment information</strong> — collected and processed by our payment processors; we do not store full card numbers</li>
              </ul>

              <h3>Information collected automatically</h3>
              <ul className="legal-list">
                <li><strong>Device and browser data</strong> — IP address, browser type, operating system, and referring URLs when you visit our website</li>
                <li><strong>Usage data</strong> — pages viewed, time on page, and navigation paths collected through analytics services</li>
                <li><strong>SMS opt-in records</strong> — when you consent to receive text messages through our client portal, we record your phone number, the exact consent language shown, timestamp, device timezone, and browser user agent to demonstrate TCPA compliance</li>
              </ul>
            </div>

            <div className="legal-section">
              <h2>2. How We Use Your Information</h2>
              <p>We use the information we collect to:</p>
              <ul className="legal-list">
                <li>Provide, schedule, and manage construction and restoration services</li>
                <li>Communicate with you about estimates, project status, appointments, and invoices</li>
                <li>Send SMS notifications about your active claim (only if you have opted in)</li>
                <li>Process payments and maintain financial records as required by law</li>
                <li>Operate and improve our client portal (MyClaim)</li>
                <li>Respond to your inquiries and support requests</li>
                <li>Comply with legal obligations, including contractor licensing requirements and TCPA regulations</li>
                <li>Protect the security of our systems and prevent fraud</li>
              </ul>
              <p>
                We do not sell, rent, or share your personal information with third parties
                for their own marketing purposes.
              </p>
            </div>

            <div className="legal-section">
              <h2>3. SMS / Text Message Communications</h2>
              <p>
                If you provide your mobile number and opt in through our client portal, we
                may send you text messages related to your restoration project — including
                status updates, appointment reminders, document requests, and billing
                notifications.
              </p>
              <ul className="legal-list">
                <li><strong>Frequency:</strong> Up to 5 messages per week during active work</li>
                <li><strong>Opt out:</strong> Reply STOP at any time to unsubscribe</li>
                <li><strong>Help:</strong> Reply HELP for support information</li>
                <li><strong>Rates:</strong> Message and data rates may apply</li>
              </ul>
              <p>
                We retain opt-in records (phone, timestamp, consent language, device data)
                as required for TCPA compliance. These records are not used for any purpose
                other than demonstrating lawful consent.
              </p>
              <p>
                For our full SMS opt-in policy, see the{' '}
                <Link to="/myclaim/opt-in-policy">SMS Opt-In Policy page</Link>.
              </p>
            </div>

            <div className="legal-section">
              <h2>4. Third-Party Services</h2>
              <p>We use the following third-party services that may receive your data:</p>
              <ul className="legal-list">
                <li>
                  <strong>Firebase (Google LLC)</strong> — Authentication, database (Firestore),
                  and file storage for our client portal. Your portal data is stored on Google's
                  infrastructure.{' '}
                  <a href="https://firebase.google.com/support/privacy" target="_blank" rel="noreferrer">
                    Firebase Privacy
                  </a>
                </li>
                <li>
                  <strong>Google Drive</strong> — We may store project documents in Google Drive
                  folders managed by our team. Document access is controlled by our account.
                </li>
                <li>
                  <strong>Firebase Phone Authentication / reCAPTCHA</strong> — Used to verify
                  your mobile number when signing into the client portal. Google may process your
                  phone number to deliver the verification SMS.
                </li>
                <li>
                  <strong>Google Analytics</strong> — We may use analytics to understand how
                  visitors interact with our public website. Analytics data is aggregated and
                  does not personally identify you.
                </li>
              </ul>
              <p>
                We do not use your data for advertising or share it with data brokers.
              </p>
            </div>

            <div className="legal-section">
              <h2>5. Cookies and Tracking</h2>
              <p>
                Our public website uses session cookies for basic functionality. Our client
                portal uses Firebase-managed authentication tokens stored in your browser to
                keep you signed in. We do not use tracking cookies for behavioral advertising.
              </p>
              <p>
                You can configure your browser to block or delete cookies, but doing so may
                prevent the client portal from functioning correctly.
              </p>
            </div>

            <div className="legal-section">
              <h2>6. Data Retention</h2>
              <p>
                We retain your personal information for as long as necessary to fulfill the
                purposes outlined in this policy and to comply with legal obligations:
              </p>
              <ul className="legal-list">
                <li>Client portal data and project records — retained for a minimum of 7 years for warranty and legal purposes</li>
                <li>SMS opt-in records — retained for a minimum of 4 years for TCPA compliance</li>
                <li>Financial and payment records — retained for at least 7 years as required by tax law</li>
                <li>Website inquiry data — retained for 2 years unless converted to an active project</li>
              </ul>
            </div>

            <div className="legal-section">
              <h2>7. Data Security</h2>
              <p>
                We take reasonable technical and organizational measures to protect your
                information. Your client portal uses TLS encryption for data in transit and
                Firebase's security rules to restrict access. Only authorized team members
                can access your project information.
              </p>
              <p>
                No method of transmission over the Internet is 100% secure. While we strive
                to protect your data, we cannot guarantee absolute security.
              </p>
            </div>

            <div className="legal-section">
              <h2>8. Your Rights</h2>
              <p>You have the right to:</p>
              <ul className="legal-list">
                <li><strong>Access</strong> — request a copy of the personal information we hold about you</li>
                <li><strong>Correction</strong> — request that we correct inaccurate information</li>
                <li><strong>Deletion</strong> — request that we delete your personal information, subject to legal retention requirements</li>
                <li><strong>Opt out of SMS</strong> — reply STOP to any text message or contact us directly</li>
                <li><strong>Portability</strong> — request your project data in a common format</li>
              </ul>
              <p>
                To exercise any of these rights, contact us using the information below. We
                will respond within 30 days.
              </p>
            </div>

            <div className="legal-section">
              <h2>9. Children's Privacy</h2>
              <p>
                Our services are intended for adults. We do not knowingly collect personal
                information from children under 13. If you believe we have inadvertently
                collected such information, please contact us and we will delete it promptly.
              </p>
            </div>

            <div className="legal-section">
              <h2>10. Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. When we do, we will
                update the "Effective" date at the top of this page. Continued use of our
                services after any changes constitutes your acceptance of the updated policy.
                For material changes, we will notify active clients by email or SMS.
              </p>
            </div>

            <div className="legal-section">
              <h2>11. Contact</h2>
              <p>
                Questions, requests, or concerns about this Privacy Policy? Contact us at:
              </p>
              <ul className="legal-list">
                <li><strong>Company:</strong> {COMPANY}</li>
                <li><strong>Phone:</strong> <a href="tel:+19732194973">{PHONE}</a></li>
                <li><strong>Email:</strong> <a href={`mailto:${EMAIL}`}>{EMAIL}</a></li>
                <li><strong>Service Area:</strong> New Jersey &amp; Surrounding Areas</li>
              </ul>
              <p style={{ marginTop: '1em' }}>
                Also see: <Link to="/terms">Terms &amp; Conditions</Link>
              </p>
            </div>

            <p className="legal-updated">Last updated: {EFFECTIVE}</p>
          </div>
        </div>
      </section>
    </>
  )
}
