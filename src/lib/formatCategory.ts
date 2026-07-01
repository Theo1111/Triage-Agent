const CATEGORY_LABELS: Record<string, string> = {
  app_or_software:            "App / Software",
  field_ops:                  "Field Ops",
  access_or_lockout:          "Access / Lockout",
  ict_or_intercom:            "ICT / Intercom",
  hardware_or_device:         "Hardware / Device",
  cameras_or_security_video:  "Cameras / Security Video",
  customer_escalation:        "Customer Escalation",
  engineering_blocker:        "Engineering Blocker",
  building_infrastructure:    "Building Infrastructure",
  sensitive_private:          "Sensitive / Private",
  not_relevant:               "Not Relevant",
};

export function formatCategoryLabel(value: string | null | undefined): string {
  if (!value) return "—";
  if (CATEGORY_LABELS[value]) return CATEGORY_LABELS[value];
  return value
    .split("_")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
