import { Link } from "react-router-dom"
import { EDITEUR } from "../lib/editeur.js"

// English versions of the legal pages. The French text (Legal.jsx) remains the reference version.
const contact = () => EDITEUR.contact || "the contact address published by the publisher"

export function ConfidentialiteEN() {
  return (
    <>
      <p>This policy explains which personal data are processed by {EDITEUR.service} ({EDITEUR.site}), an online application for managing
        grades, report cards and school discipline published by {EDITEUR.nom}, why they are processed and what your rights are.</p>
      <p><em>The French version of this policy is the reference version.</em></p>

      <h2>1. Who is responsible for the data?</h2>
      <p>Each school that creates a space on {EDITEUR.service} decides which data it records there (students, grades, staff): it is the
        <strong> data controller</strong>. {EDITEUR.nom} acts on its behalf as a <strong>data processor</strong>: we host and process these data
        solely to provide the service, according to the school's instructions.</p>
      <p>For the data needed to run the service itself (founder account, security, technical logs), {EDITEUR.nom} is the data controller.</p>

      <h2>2. Data processed</h2>
      <ul>
        <li><strong>School</strong>: name, city, address, phone number, motto, name of the head of school.</li>
        <li><strong>Founder signed in with Google</strong>: Google account identifier, email address, first and last name provided by Google.</li>
        <li><strong>Staff</strong>: last name, first name, role (administration, teacher, discipline master, accountant), optional staff ID and phone
          number, date of last sign-in. Access codes are <strong>never stored in plain text</strong>: only an encrypted fingerprint is recorded.</li>
        <li><strong>Students</strong> (data concerning minors): student ID, last name, first name, sex, date and place of birth, a parent's phone number,
          optional photo, class, grades, absences, lateness, offences and sanctions.</li>
        <li><strong>School fees</strong>: amounts due according to the student's category (new or returning), payment schedule, recorded payments
          (date, amount, method, reference) and receipts, visible to the administration and the accounts office only.</li>
        <li><strong>Language preference</strong>: French or English, stored on the device.</li>
        <li><strong>Technical data</strong>: IP address (used only to limit attempts with wrong codes), the host's security logs, session token.</li>
      </ul>

      <h2>3. Purposes and legal bases</h2>
      <ul>
        <li>Providing the school management service to the school (performance of the contract with the school).</li>
        <li>Authenticating users and protecting accounts against unauthorised access (legitimate interest in security).</li>
        <li>Answering support requests and complying with our legal obligations.</li>
      </ul>
      <p>The data are <strong>never used for advertising</strong>, never sold or rented, and never used to train artificial intelligence models.</p>

      <h2>4. Data received from Google</h2>
      <p>When a school's founder chooses "Sign in with Google", {EDITEUR.service} receives only their Google identifier, email address, name and
        profile picture ("openid", "email" and "profile" scopes). This information is used solely to create and secure their administrator account and
        to pre-fill their name. It is neither shared with third parties nor used for any other purpose. The use of information received from Google APIs
        complies with the
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer"> Google API Services User Data
        Policy</a>, including the Limited Use requirements.</p>

      <h2>5. Recipients</h2>
      <p>A school's data are accessible only to that school's staff, according to their role: the database technically refuses any read or write
        outside the user's school. Our technical providers access them only to provide hosting:</p>
      <ul>
        <li><strong>Supabase</strong>: database, authentication and photo storage, hosted in a data centre in Paris (France).</li>
        <li><strong>Netlify</strong>: hosting and delivery of the application's pages (no student data is stored there).</li>
        <li><strong>Google</strong>: only for signing in founders who choose this method.</li>
      </ul>
      <p>Some of these providers may process technical data outside the user's country; they are contractually bound to confidentiality and
        security safeguards.</p>

      <h2>6. Retention period</h2>
      <ul>
        <li>School data: as long as the school's space is active; the school can delete students, grades or staff members at any time.</li>
        <li>When a space is closed: deletion within 90 days, unless the law requires otherwise. The school can first export its data in Excel format.</li>
        <li>Code attempt counters: deleted after a successful sign-in; device tokens: 30 days.</li>
      </ul>

      <h2>7. Security</h2>
      <p>Encrypted connections (HTTPS); each school isolated by security rules enforced by the database; encrypted access codes and temporary lockout
        after several wrong attempts; photos stored in a private area, reachable only through temporary links; no secret key in the code sent to the browser.</p>

      <h2>7a. Platform administration</h2>
      <p>To provide support, security and the proper operation of the service, {EDITEUR.nom} has an administration console reserved for the publisher.
        It mainly shows account information (schools, staff members, creation and last sign-in dates) and overall statistics. A school's student list is
        displayed there only at the publisher's express request, for support or security reasons, and every view, suspension or deletion is logged.</p>

      <h2>8. Data of minor students</h2>
      <p>Student data are entered by the school, under its responsibility. It is up to the school to inform students and their parents or legal
        guardians that it uses {EDITEUR.service} and, where the law requires it, to obtain their consent (in particular for photos). Students and parents
        have no account on the service.</p>

      <h2>9. Cookies and local storage</h2>
      <p>{EDITEUR.service} uses <strong>no advertising cookies and no audience measurement tools</strong>. The browser only keeps the sign-in session,
        the selected school and the language on the device (local storage), which are essential for the service to work.</p>

      <h2>10. Artificial intelligence agents (API and MCP)</h2>
      <p>A school's administration can enable access for AI agents (Claude or others) in the Developer area; this access is
        <strong> disabled by default</strong>. A staff member can then create an API key or authorise an application: the agent acts with the same
        rights as their account. The data viewed by the agent (for example grades and student names) are sent to the AI provider chosen by the user,
        under that provider's terms and the school's responsibility. Keys are stored encrypted and can be revoked, and write actions are recorded in a log
        the administration can consult.</p>

      <h2>11. Your rights</h2>
      <p>Under the applicable personal data protection laws (in particular in {EDITEUR.pays === "Cameroun" ? "Cameroon" : EDITEUR.pays} and, where it
        applies, the European Union's General Data Protection Regulation), you have the right of access, rectification, erasure, restriction and
        objection. For school data, first contact your school's administration, which can view, correct or delete them directly. For any other request,
        contact {EDITEUR.nom}: {contact()}. You may also lodge a complaint with the competent data protection authority.</p>

      <h2>12. Changes</h2>
      <p>This policy may change. The date of the last update appears at the top of the page; in the event of a significant change, school
        administrators will be informed.</p>
    </>
  )
}

export function ConditionsEN() {
  return (
    <>
      <p>These terms govern the use of {EDITEUR.service} ({EDITEUR.site}), an online service for managing school grades, report cards, discipline and
        statistics, published by {EDITEUR.nom}. By creating a school's space or using the service, you accept these terms.</p>
      <p><em>The French version of these terms is the reference version.</em></p>

      <h2>1. The service</h2>
      <p>{EDITEUR.service} lets a school manage its school years, classes, subjects, students, grades, results, report cards, discipline, school fees
        and statistics, in French or in English, and import or export these data in Excel format. The service is available from a web browser; it is
        currently offered <strong>free of charge</strong>. Any pricing change would be announced in advance and would only apply with the school's agreement.</p>

      <h2>2. Creating the space and accounts</h2>
      <ul>
        <li>A school's space is created by a person authorised to represent it (head of school or an appointed person), who signs in with their Google
          account and becomes the founding administrator.</li>
        <li>The administration creates staff accounts; each member receives a <strong>personal code</strong>. The school code and personal codes are
          confidential: share them only with the people concerned and change them if in doubt.</li>
        <li>Each user is responsible for the actions carried out with their code. Report any suspicious use to your school's administration without delay.</li>
      </ul>

      <h2>3. The school's commitments</h2>
      <ul>
        <li>Enter accurate and lawful data, and only the data needed for school management.</li>
        <li>Inform students, parents and staff that the service is used and obtain the consents required by law (in particular for photos).</li>
        <li>Give each staff member the role suited to their duties and deactivate the accounts of people who leave the school.</li>
        <li>Keep its own exports of important data (report cards, results) in line with its administrative obligations.</li>
      </ul>

      <h2>4. Prohibited uses</h2>
      <p>It is forbidden to try to access another school's data, to circumvent security measures, to guess or share other people's codes, to disrupt
        the service (mass automated requests, attacks), to upload unlawful content or to use the service for any purpose other than school management.</p>

      <h2>5. API access and AI agents</h2>
      <p>When the administration enables AI agent access, API keys and authorisations granted to third-party applications are personal, confidential and
        revocable. Each user is responsible for the actions taken on their behalf by the agent they connect and for checking the summaries before any
        write. The school decides whether or not to send its data to an AI provider. It is forbidden to use the API to extract data in bulk for purposes
        unrelated to school management or to circumvent usage limits.</p>

      <h2>5a. Data and ownership</h2>
      <p>The school remains the owner of its data. {EDITEUR.nom} processes them solely to provide the service, as described in the
        <Link to="/confidentialite"> privacy policy</Link>. The software, its interface and its brand remain the property of {EDITEUR.nom}.</p>

      <h2>6. Availability</h2>
      <p>We do our best to keep the service available and secure, but cannot guarantee permanent availability: interruptions may occur for maintenance,
        updates or because of our hosting providers. The service is provided "as is".</p>

      <h2>7. Liability</h2>
      <p>Calculations (averages, ranks, conduct marks) rely on the data and settings entered by the school, which remains solely responsible for decisions
        made on the basis of these results and for checking report cards before they are distributed. To the extent permitted by law, {EDITEUR.nom} cannot
        be held liable for indirect damage or damage resulting from misuse of the service.</p>

      <h2>8. Suspension and closure</h2>
      <p>The school may stop using the service at any time and request the deletion of its space. {EDITEUR.nom} may suspend a space in the event of a
        serious breach of these terms, a security risk or non-payment of a paid offer, after notifying the school's administration except in an emergency.
        During a suspension nobody can sign in to the space, but its data are kept. Before any closure on our initiative, the school will have a reasonable
        period to export its data.</p>

      <h2>9. Changes to the terms</h2>
      <p>These terms may change; the date of the last update appears at the top of the page. In the event of a significant change, school administrators
        will be informed before it takes effect.</p>

      <h2>10. Governing law and contact</h2>
      <p>These terms are governed by the law applicable in {EDITEUR.pays === "Cameroun" ? "Cameroon" : EDITEUR.pays}. In the event of a dispute, we favour
        an amicable solution: contact {EDITEUR.nom} at {contact()}.</p>
    </>
  )
}
