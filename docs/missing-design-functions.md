# Missing Design Functions

The dashboard design references in `docs/design/` include several visual elements that are not implemented in the product yet. They were intentionally left out of this design pass to avoid non-functional controls.

## Not Implemented

- **Global Search:** The search field in the portfolio reference is not connected to platform, transaction, or history search.
- **Filter:** The platform table filter action is not implemented because there is no current filter state or filtering flow.
- **Summary / Details / History Tabs:** The segmented control in the reference is not implemented because the dashboard currently uses real app-level tabs only.
- **Notifications:** The notification icon and unread state in the references have no backing notification model.
- **Account Menu:** The account-circle control is not implemented because there is no profile or account menu flow.
- **Footer Links:** Privacy Policy, Terms of Service, API Docs, and Support links are not present in the extension dashboard.
- **View Full History:** The expanded platform history remains inline in the main table grid. There is no separate full-history route or modal yet.

## Implemented Instead

- Existing functional controls remain available: sync all, per-platform sync, privacy mode, theme toggle, lock, add platform, settings, debug, and extractor test flows.
- The expanded platform history keeps the current product behavior: change rows are rendered directly in the main table columns rather than as a nested table.
