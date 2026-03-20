#!/bin/bash
# Seed dummy appointments into DynamoDB for testing.
# Usage: bash infra/scripts/seed-appointments.sh <provider_id>

set -e

PROVIDER_ID="${1:?Usage: bash infra/scripts/seed-appointments.sh <provider_id>}"
TABLE_NAME="vantage-dev"
REGION="us-east-1"
TODAY=$(date +%Y-%m-%d)

echo "Seeding appointments for provider $PROVIDER_ID on $TODAY..."

seed_appointment() {
  local APPT_ID="appt-$(uuidgen | tr '[:upper:]' '[:lower:]' | cut -c1-12)"
  local NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local PATIENT_NAME="$1"
  local TYPE="$2"
  local START="$3"
  local END="$4"
  local STATUS="$5"
  local REASON="$6"
  local NOTES="$7"

  aws dynamodb put-item \
    --table-name "$TABLE_NAME" \
    --region "$REGION" \
    --item "{
      \"PK\": {\"S\": \"PROVIDER#$PROVIDER_ID\"},
      \"SK\": {\"S\": \"APPT#$TODAY#$APPT_ID\"},
      \"appointmentId\": {\"S\": \"$APPT_ID\"},
      \"providerId\": {\"S\": \"$PROVIDER_ID\"},
      \"patientName\": {\"S\": \"$PATIENT_NAME\"},
      \"appointmentType\": {\"S\": \"$TYPE\"},
      \"startTime\": {\"S\": \"${TODAY}T${START}:00\"},
      \"endTime\": {\"S\": \"${TODAY}T${END}:00\"},
      \"status\": {\"S\": \"$STATUS\"},
      \"reason\": {\"S\": \"$REASON\"},
      \"notes\": {\"S\": \"$NOTES\"},
      \"createdAt\": {\"S\": \"$NOW\"},
      \"entityType\": {\"S\": \"Appointment\"}
    }" \
    --no-cli-pager

  echo "  + $START $PATIENT_NAME ($TYPE, $STATUS)"
}

seed_appointment "Maria Garcia"     "in_office"   "09:00" "09:30" "completed"  "Annual physical exam"           "Patient in good health. Labs ordered."
seed_appointment "James Wilson"     "in_office"   "09:30" "10:00" "completed"  "Blood pressure follow-up"       "BP 128/82, medication adjusted."
seed_appointment "Sarah Chen"       "telehealth"  "10:00" "10:30" "checked_in" "Medication review"              ""
seed_appointment "Robert Johnson"   "in_office"   "11:00" "11:45" "scheduled"  "New patient intake"             "Referral from Dr. Park"
seed_appointment "Emily Davis"      "phone"       "13:00" "13:15" "scheduled"  "Lab results discussion"         ""
seed_appointment "Michael Brown"    "in_office"   "14:00" "14:30" "scheduled"  "Knee pain follow-up"            "X-ray results available"
seed_appointment "Lisa Thompson"    "telehealth"  "15:00" "15:30" "scheduled"  "Anxiety management check-in"    ""
seed_appointment "David Martinez"   "in_office"   "16:00" "16:30" "cancelled"  "Diabetes management"            "Patient called to reschedule"

echo "Done! Seeded 8 appointments for $TODAY."
