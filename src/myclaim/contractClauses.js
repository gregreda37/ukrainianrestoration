// Shared contract clauses used by both the PDF generator and the public invoice view.
// [Company Name] is replaced at render time with inv.companyName.

export const CONTRACT_CLAUSES = [
  {
    title: '1. PAYMENT TERMS',
    body:
      'Full payment for all services rendered is due upon completion of the work specified in this invoice. ' +
      'In the event that an insurance company retains a holdback or depreciation amount from the settlement, ' +
      'the customer agrees to remit all such holdback and depreciation funds directly to [Company Name] within ' +
      'fifteen (15) days of the customer\'s receipt of those funds from the insurance company. Failure to remit ' +
      'payment within the stated period may result in late fees of 1.5% per month on the unpaid balance, ' +
      'suspension of any warranty obligations, and referral of the account to a collections agency.',
  },
  {
    title: '2. INSURANCE PROCEEDS & ASSIGNMENT OF BENEFITS',
    body:
      'The customer agrees to cooperate fully with the insurance claim process and to notify [Company Name] ' +
      'immediately upon receipt of any insurance proceeds related to this work. The customer agrees to endorse ' +
      'and remit to [Company Name] any insurance checks or electronic payments that include amounts covered by ' +
      'this invoice. The customer shall not negotiate, reduce, or accept settlement of insurance proceeds ' +
      'covering this work without prior written consent from [Company Name]. Any amounts received by the ' +
      'customer from the insurance carrier intended to cover work performed by [Company Name] must be forwarded ' +
      'to [Company Name] within fifteen (15) days of receipt.',
  },
  {
    title: '3. SCOPE OF WORK & CHANGE ORDERS',
    body:
      'This invoice covers only the scope of work described herein. Any additional work, materials, or services ' +
      'beyond the stated scope require a written change order signed by both parties prior to commencement of ' +
      'such additional work. [Company Name] reserves the right to suspend work on any additions or modifications ' +
      'to scope until a duly executed change order is in place, without liability for delays or damages arising ' +
      'from such suspension. Verbal authorizations do not constitute a change order.',
  },
  {
    title: '4. RIGHT TO STOP WORK & MECHANIC\'S LIEN RIGHTS',
    body:
      'In the event of non-payment or material breach of this agreement by the customer, [Company Name] ' +
      'reserves the right to immediately suspend or terminate work without liability for any resulting delays, ' +
      'damages, or consequential losses. [Company Name] further reserves all rights available under applicable ' +
      'mechanic\'s lien and materialman\'s lien statutes, and may file and enforce a lien against the subject ' +
      'property to secure any unpaid amounts owed hereunder. The customer acknowledges these rights and agrees ' +
      'not to unreasonably contest the exercise thereof.',
  },
  {
    title: '5. WARRANTY',
    body:
      '[Company Name] warrants all workmanship against defects for a period of one (1) year from the date of ' +
      'substantial completion of the work described in this invoice. This warranty is void if the customer ' +
      'fails to properly maintain the property, or if damage results from acts of God, third-party actions, ' +
      'misuse, customer negligence, or pre-existing conditions not disclosed prior to commencement. All ' +
      'materials and equipment furnished are warranted solely pursuant to the applicable manufacturer\'s ' +
      'warranty, which [Company Name] will assign to the customer to the extent assignable.',
  },
  {
    title: '6. PROPERTY ACCESS & SITE CONDITIONS',
    body:
      'The customer grants [Company Name] and its authorized employees and subcontractors reasonable access to ' +
      'the work site during normal business hours and at other mutually agreed times to complete the work. ' +
      'The customer represents that no known hazardous materials — including but not limited to asbestos, lead ' +
      'paint, or mold beyond that identified in the insurance scope of loss — are present at the work site. ' +
      'If hazardous conditions are discovered during the course of work, [Company Name] will suspend operations ' +
      'in the affected area, notify the customer, and require execution of a written change order prior to ' +
      'resuming work in that area.',
  },
  {
    title: '7. SUBCONTRACTORS',
    body:
      '[Company Name] may engage licensed and insured subcontractors to perform portions of the work described ' +
      'herein. All such subcontractors shall be bound by the same quality and workmanship standards applicable ' +
      'to [Company Name]. The use of subcontractors does not diminish [Company Name]\'s obligations under this ' +
      'agreement, and [Company Name] remains responsible to the customer for the quality and timely completion ' +
      'of all work.',
  },
  {
    title: '8. INDEMNIFICATION',
    body:
      'To the fullest extent permitted by applicable law, the customer agrees to indemnify, defend, and hold ' +
      'harmless [Company Name], its officers, employees, agents, and subcontractors from and against any and ' +
      'all claims, damages, losses, costs, and expenses (including reasonable attorneys\' fees) arising out of ' +
      'or related to: (a) pre-existing structural or site conditions not disclosed prior to commencement of ' +
      'work; (b) hidden damage, hazardous materials, or code deficiencies discovered during the work; ' +
      '(c) the customer\'s failure to cooperate with the insurance claim process; or (d) the customer\'s ' +
      'material breach of any provision of this agreement.',
  },
  {
    title: '9. PERMITS & CODE COMPLIANCE',
    body:
      'Unless otherwise specified in writing, [Company Name] will obtain all required building permits for the ' +
      'scope of work described herein, and permit fees are the responsibility of the customer. Any code upgrade ' +
      'requirements mandated by local, state, or federal authorities that exceed the original scope of loss as ' +
      'described in the insurance estimate will be addressed through a separate written change order and billed ' +
      'accordingly. [Company Name] is not responsible for pre-existing code violations unrelated to the stated ' +
      'scope of work.',
  },
  {
    title: '10. LIMITATION OF LIABILITY',
    body:
      'In no event shall [Company Name] be liable for indirect, incidental, consequential, special, or ' +
      'punitive damages of any kind arising out of or related to this agreement, including but not limited to ' +
      'loss of use, loss of revenue, or loss of business opportunity, even if [Company Name] has been advised ' +
      'of the possibility of such damages. [Company Name]\'s total aggregate liability for any claim arising ' +
      'hereunder shall not exceed the total amount paid by the customer under this invoice.',
  },
  {
    title: '11. DISPUTE RESOLUTION',
    body:
      'Any dispute arising from or related to this agreement or the work performed hereunder shall first be ' +
      'submitted to non-binding mediation conducted by a mutually agreed neutral mediator before either party ' +
      'may initiate litigation or arbitration. In the event litigation is necessary, the prevailing party shall ' +
      'be entitled to recover reasonable attorneys\' fees and costs. This agreement is governed by and construed ' +
      'in accordance with the laws of the state in which the work is performed, without regard to conflicts of ' +
      'law principles.',
  },
  {
    title: '12. ELECTRONIC SIGNATURE & ENTIRE AGREEMENT',
    body:
      'The parties agree that an electronic signature applied to this document is legally binding and has the ' +
      'same force and effect as a handwritten signature, pursuant to the Electronic Signatures in Global and ' +
      'National Commerce Act (ESIGN) and the Uniform Electronic Transactions Act (UETA). By signing ' +
      'electronically, the customer confirms they have read, understood, and agree to all terms and conditions ' +
      'contained in this invoice and agreement. This invoice, together with any attached scope documents, ' +
      'constitutes the entire agreement between the parties with respect to the work described herein. All ' +
      'prior oral or written representations are superseded. Any modification must be in writing and signed ' +
      'by both parties.',
  },
]
