/**
 * Canonical brand constants for Micky's by CP Foods, sourced from the official
 * kit reference documents (price cards, distributor agreement, quotation).
 * These are the single source of truth for everything rendered into a sales kit.
 */
const brand = {
  brandName: "MICKY'S BY CP FOODS",
  legalEntity: 'Centre Point Foods Private Limited',
  legalEntityShort: 'Centre Point Foods Pvt. Ltd.',
  tagline: "Rasoi Ki Taiyaari, Micky's Ki Zimmedari",
  positioning: "India's First Cooking Convenience Brand",

  address: 'FP-55 & FP-56, Five Star Industrial Area, Butibori MIDC, Nagpur – 441122',
  fssai: '11525056000326',

  website: 'www.mickys.in',

  // Authorised signatory shown on agreements / quotation acceptance.
  signatory: {
    name: 'Angadh Arora',
    designation: 'Chief Executive Officer',
  },

  // Primary sales contact printed in document footers.
  contact: {
    name: 'Manoj Yadav',
    phone: '+91 92719 73474',
    email: 'sales1.cpfoods@cpgh.in',
  },

  // Banking details for the quotation payment block.
  bank: {
    accountNo: '50200112436961',
    ifsc: 'HDFC0002818',
    mode: 'NEFT / RTGS / Bank Transfer',
  },
};

module.exports = brand;
