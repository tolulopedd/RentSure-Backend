WITH rule_updates AS (
  SELECT *
  FROM (
    VALUES
      ('REGISTRATION_COMPLETED', 'Account created', 'Tracks the account-created milestone inside Identity & Verification.', 20, 1, 10),
      ('EMAIL_VERIFIED', 'Email verified', 'Tracks the email verification milestone inside Identity & Verification.', 20, 1, 20),
      ('PHONE_UPDATED', 'Phone updated', 'Tracks when a renter has provided a phone number for the profile.', 20, 1, 30),
      ('GOVERNMENT_ID_VERIFIED', 'Government ID verified', 'Tracks when a renter verifies NIN or BVN on RentSure.', 20, 1, 40),
      ('COMPLETE_PROFILE', 'Complete profile', 'Tracks when the renter profile has the required contact and address details.', 20, 1, 50),
      ('RENT_PAID_ON_OR_BEFORE_DUE_DATE', 'Rent paid on or before due date', 'Rent paid on or before the due date.', 150, 1, 60),
      ('RENT_PAID_WITHIN_GRACE_PERIOD', 'Paid within grace period (30 days)', 'Rent paid within the allowed grace period after the due date.', 100, 1, 70),
      ('RENT_PAID_31_TO_90_DAYS_LATE', 'Paid 31-90 days late', 'Rent paid between 31 and 90 days after the due date.', 75, 1, 80),
      ('RENT_PAID_OVER_90_DAYS_LATE', 'Paid over 90 days late', 'Rent paid more than 90 days after the due date.', 50, 1, 90),
      ('UTILITY_NO_OUTSTANDING_DEBT', 'No outstanding utility debt', 'No outstanding utility debt is recorded for the renter.', 100, 1, 100),
      ('UTILITY_MINOR_OUTSTANDING_DEBT', 'Minor outstanding debt', 'Only a minor utility debt is outstanding.', 75, 1, 110),
      ('UTILITY_SIGNIFICANT_OUTSTANDING_DEBT', 'Significant outstanding debt', 'A significant utility debt is outstanding.', 25, 1, 120),
      ('RENTAL_BEHAVIOUR_EXCELLENT', 'Rental behaviour: Excellent', 'Latest landlord maintenance and lease-compliance rating is Excellent.', 200, 1, 130),
      ('RENTAL_BEHAVIOUR_GOOD', 'Rental behaviour: Good', 'Latest landlord maintenance and lease-compliance rating is Good.', 150, 1, 140),
      ('RENTAL_BEHAVIOUR_FAIR', 'Rental behaviour: Fair', 'Latest landlord maintenance and lease-compliance rating is Fair.', 100, 1, 150),
      ('RENTAL_BEHAVIOUR_POOR', 'Rental behaviour: Poor', 'Latest landlord maintenance and lease-compliance rating is Poor.', 50, 1, 160),
      ('DAMAGES_REPORTED', 'Damages reported', 'Penalty applied when landlord confirms damage or serious misuse reports.', -100, NULL, 170),
      ('RENTAL_STABILITY_1_MOVE', '1 move in last 5 years', 'Renter moved once within the last five years.', 75, 1, 180),
      ('RENTAL_STABILITY_2_MOVES', '2 moves in last 5 years', 'Renter moved twice within the last five years.', 50, 1, 190),
      ('RENTAL_STABILITY_3_MOVES', '3 moves in last 5 years', 'Renter moved three times within the last five years.', 35, 1, 200),
      ('RENTAL_STABILITY_4_MOVES', '4 moves in last 5 years', 'Renter moved four times within the last five years.', 25, 1, 210),
      ('RENTAL_STABILITY_5_PLUS_MOVES', '5 moves in last 5 years', 'Renter moved five or more times within the last five years.', 10, 1, 220),
      ('EMPLOYMENT_STABILITY_1_EMPLOYER', '1 employer in last 5 years', 'Renter had one employer or business in the last five years.', 75, 1, 230),
      ('EMPLOYMENT_STABILITY_2_EMPLOYERS', '2 employers in last 5 years', 'Renter had two employers or businesses in the last five years.', 50, 1, 240),
      ('EMPLOYMENT_STABILITY_3_EMPLOYERS', '3 employers in last 5 years', 'Renter had three employers or businesses in the last five years.', 35, 1, 250),
      ('EMPLOYMENT_STABILITY_4_EMPLOYERS', '4 employers in last 5 years', 'Renter had four employers or businesses in the last five years.', 25, 1, 260),
      ('EMPLOYMENT_STABILITY_5_PLUS_EMPLOYERS', '5+ employers in last 5 years', 'Renter had five or more employers or businesses in the last five years.', 10, 1, 270),
      ('LANDLORD_REFERENCE_STRONGLY_RECOMMEND', 'Landlord reference: Strongly recommend', 'Latest verified landlord reference is strongly recommend.', 100, 1, 280),
      ('LANDLORD_REFERENCE_RECOMMEND', 'Landlord reference: Recommend', 'Latest verified landlord reference is recommend.', 75, 1, 290),
      ('LANDLORD_REFERENCE_NEUTRAL', 'Landlord reference: Neutral', 'Latest verified landlord reference is neutral.', 40, 1, 300),
      ('LANDLORD_REFERENCE_DO_NOT_RECOMMEND', 'Landlord reference: Do not recommend', 'Latest verified landlord reference is do not recommend.', 0, 1, 310),
      ('RENTER_BAND_D', 'Band D (< 500,000)', 'Property rent amount falls below 500,000.', 100, 1, 320),
      ('RENTER_BAND_C', 'Band C (500,000 - 1M)', 'Property rent amount falls between 500,000 and 1,000,000.', 75, 1, 330),
      ('RENTER_BAND_B', 'Band B (1M - 2.5M)', 'Property rent amount falls between 1,000,000 and 2,500,000.', 50, 1, 340),
      ('RENTER_BAND_A', 'Band A (> 2.5M)', 'Property rent amount is above 2,500,000.', 25, 1, 350),
      ('UTILITY_DISCONNECTION', 'Utility disconnection', 'Marker used when utility service was disconnected for non-payment.', 0, 1, 360),
      ('RENT_DEFAULTED_OR_EVICTED', 'Rent defaulted or evicted', 'Marker used when a renter defaults or is evicted.', 0, 1, 370)
  ) AS updates(code, name, description, points, max_occurrences, sort_order)
)
UPDATE "RentScoreRule" AS rule
SET
  "name" = rule_updates.name,
  "description" = rule_updates.description,
  "points" = rule_updates.points,
  "maxOccurrences" = rule_updates.max_occurrences,
  "sortOrder" = rule_updates.sort_order
FROM rule_updates
WHERE rule."code" = rule_updates.code;
