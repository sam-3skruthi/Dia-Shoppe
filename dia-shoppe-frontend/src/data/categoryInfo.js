/*
  Category guides shown when a shopper opens a category on the homepage.

  ⚠ DRAFT COPY — written for the revamp, pending the owner's review before
  launch. It is deliberately GENERAL product guidance (what the equipment is
  for, who uses it, what to compare when choosing). It makes no claims about
  Dia Shoppe's own stock, services, prices or delivery: everything specific to
  the store (brands, counts, prices, availability) is computed live from the
  catalog in CategoryShowcase. It is not medical advice; the panel says so.
*/
export const categoryInfo = {
  glucose: {
    overview:
      'Blood glucose monitors let people with diabetes check their sugar levels at home, between doctor visits. A small drop of blood on a test strip gives a reading in seconds; continuous glucose monitors (CGMs) use a small sensor worn on the arm to track levels around the clock.',
    whoFor: ['People managing type 1 or type 2 diabetes', 'Caregivers checking on elderly parents', 'Clinics and pharmacies doing quick screenings'],
    lookFor: [
      'Ongoing cost and availability of the matching test strips or sensors',
      'Sample size and reading time',
      'Memory, averages and app or phone connectivity',
      'Large, clear display and simple buttons for older users',
    ],
  },
  bp: {
    overview:
      'Blood pressure monitors measure systolic and diastolic pressure and pulse, so hypertension can be tracked at home with readings that are often more representative than a single clinic visit. Digital upper-arm monitors are the most common choice; manual (aneroid) apparatus is used by trained professionals.',
    whoFor: ['People with high or low blood pressure', 'Anyone advised by a doctor to log readings at home', 'Doctors, nurses and clinics'],
    lookFor: [
      'Upper-arm cuff in the right size for the arm',
      'Irregular-heartbeat detection and averaged readings',
      'Memory for more than one user',
      'Power options: batteries, adapter or both',
    ],
  },
  respiratory: {
    overview:
      'Respiratory care equipment helps people breathe more easily at home or in care settings. Nebulizers turn liquid medicine into a fine mist to inhale, oxygen concentrators supply oxygen-enriched air, and CPAP or BiPAP machines keep airways open during sleep.',
    whoFor: ['People with asthma, COPD or other breathing conditions', 'Patients recovering at home', 'Sleep apnea patients on prescribed therapy'],
    lookFor: [
      'What your doctor has prescribed (settings, flow rate, mask type)',
      'Noise level, especially for night-time use',
      'Ease of cleaning and availability of masks and accessories',
      'Size and portability if it will be moved around',
    ],
  },
  hospital: {
    overview:
      'Hospital equipment covers the larger items used to care for patients in clinics, nursing homes and at home, such as patient beds, furniture and day-to-day patient care supplies. Choosing well makes care safer and easier for both the patient and the people looking after them.',
    whoFor: ['Hospitals, clinics and nursing homes', 'Families setting up care at home', 'Caregivers supporting bedridden patients'],
    lookFor: [
      'Adjustable positions and safety rails for beds',
      'Weight capacity and build material',
      'Easy-clean surfaces and wheels with locks',
      'Space available where it will be used',
    ],
  },
  mobility: {
    overview:
      'Walking aids help people move around safely and independently, whether after surgery or an injury, or as a long-term support. The range runs from walking sticks and walkers to wheelchairs for longer distances or full support.',
    whoFor: ['Elderly people wanting extra stability', 'Patients recovering from surgery or injury', 'People with long-term mobility needs'],
    lookFor: [
      'Height adjustment to suit the user',
      'Weight capacity and frame material (lighter aluminium or sturdier steel)',
      'Foldability for storage and travel',
      'Grip comfort, brakes and wheel type',
    ],
  },
  devices: {
    overview:
      'Everyday medical and wellness devices for clinics and homes: stethoscopes for listening to the heart and lungs, suction machines for clearing airways, massagers for comfort and muscle relief, and other day-to-day instruments.',
    whoFor: ['Doctors, nurses and medical students', 'Clinics equipping consultation rooms', 'Home care and personal wellness'],
    lookFor: [
      'Professional versus home-use grade',
      'Acoustic quality and fit for stethoscopes',
      'Power, suction strength and portability for suction units',
      'Warranty and availability of spare parts',
    ],
  },
}
