import { useState } from 'react'

const PhoneIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.82 19.79 19.79 0 012 1.18 2 2 0 014 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" /></svg>
)

const MailIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
)

const MapPinIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
)

const ClockIcon = () => (
  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
)

const CheckIcon = () => (
  <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
)

const SERVICES = [
  'Water Damage Recovery',
  'Kitchen Remodeling',
  'Bathroom Renovation',
  'Drywall & Painting',
  'Flooring Installation',
  'Carpentry & Trim',
  'Tile Work',
  'Deck / Exterior',
  'Handyman Services',
  'Junk Removal',
  'Other / Not Sure',
]

const CONTACT_ITEMS = [
  { icon: <PhoneIcon />, label: 'Phone', value: '(973) 219-4973', href: 'tel:+19732194973' },
  { icon: <MailIcon />, label: 'Email', value: 'info@ukrainianrestoration.com', href: null },
  { icon: <MapPinIcon />, label: 'Service Area', value: 'New Jersey & Surrounding Areas', href: null },
  { icon: <ClockIcon />, label: 'Hours', value: 'Mon–Fri 7am–6pm · Sat 8am–3pm', href: null },
]

export default function Contact() {
  const [submitted, setSubmitted] = useState(false)
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '', service: '', message: '',
  })

  const handleChange = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const handleSubmit = e => {
    e.preventDefault()
    setSubmitted(true)
  }

  return (
    <>
      <div className="page-banner">
        <div className="container">
          <h1>Get in Touch</h1>
          <p>Free estimates on all projects. We respond within one business day.</p>
        </div>
      </div>

      <section className="section">
        <div className="container">
          <div className="contact-layout">
            <div className="contact-info-side">
              <h2>Let&#39;s Talk About Your Project</h2>
              <p>
                Fill out the form and we&#39;ll get back to you within one business day.
                For urgent water damage situations, call us directly.
              </p>

              {CONTACT_ITEMS.map(({ icon, label, value, href }) => (
                <div className="contact-item" key={label}>
                  <div className="contact-item__icon">{icon}</div>
                  <div>
                    <h4>{label}</h4>
                    {href
                      ? <a href={href}>{value}</a>
                      : <p>{value}</p>
                    }
                  </div>
                </div>
              ))}
            </div>

            <div className="contact-form-box">
              {submitted ? (
                <div className="form-success">
                  <div className="form-success__icon"><CheckIcon /></div>
                  <h3>Message Sent!</h3>
                  <p>We&#39;ll get back to you within one business day. For urgent matters, call (973) 219-4973.</p>
                </div>
              ) : (
                <>
                  <h3>Request a Free Estimate</h3>
                  <form onSubmit={handleSubmit}>
                    <div className="form-row">
                      <div className="form-group">
                        <label htmlFor="firstName">First Name</label>
                        <input id="firstName" name="firstName" type="text" required placeholder="Jane" value={form.firstName} onChange={handleChange} />
                      </div>
                      <div className="form-group">
                        <label htmlFor="lastName">Last Name</label>
                        <input id="lastName" name="lastName" type="text" required placeholder="Smith" value={form.lastName} onChange={handleChange} />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label htmlFor="email">Email</label>
                        <input id="email" name="email" type="email" required placeholder="jane@email.com" value={form.email} onChange={handleChange} />
                      </div>
                      <div className="form-group">
                        <label htmlFor="phone">Phone</label>
                        <input id="phone" name="phone" type="tel" placeholder="(555) 000-0000" value={form.phone} onChange={handleChange} />
                      </div>
                    </div>
                    <div className="form-group">
                      <label htmlFor="service">Service Needed</label>
                      <select id="service" name="service" value={form.service} onChange={handleChange}>
                        <option value="">Select a service...</option>
                        {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label htmlFor="message">Tell Us About Your Project</label>
                      <textarea
                        id="message" name="message"
                        placeholder="Describe the project — scope, timeline, location, any details that help us understand the job."
                        value={form.message} onChange={handleChange}
                      />
                    </div>
                    <button type="submit" className="btn btn-primary form-submit">
                      Send Request &rarr;
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
