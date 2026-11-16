# Course-page buttons

The assistant adds rounded **View course** buttons for recognized courses in its answer, plus a **Browse all courses** link. Existing Markdown links to known course pages also render as rounded links. Pages open in a new tab, preserving the chat.

The destination registry is `src/lib/courseLinks.js`. Names and URLs were checked on 14 November 2026 against the [official course directory](https://apprenticeshipconnect.co.uk/apprenticeship-courses/) and each linked course page. The registry follows actual published URLs rather than generating slugs from course names. For example, Early Years Educator uses `/level-3-childcare-apprenticeship/`, and Internal Recruiter uses `/level-3-internal-recruiter/` rather than the older `/course/` URL.

Only the course name, level and page link are taken from this directory; no fees, eligibility, duration, placement status or course explanation are synthesized. The Level 4 Accounting Technician page has an incorrect HTML title but the visible course heading identifies **Professional Accounting Technician Level 4**; the visible heading and directory agree on the destination.

Unknown courses, conflicting explicit levels and ordinary recruiter mentions do not receive guessed destinations. The directory remains available for course questions that have no match. Source links are resolved only when they match a known official page. Private search-index URIs are never used as page links.

For broad requests such as "Which all courses do you offer?", if the answer omits course names, the UI
shows the checked directory entries under **From the course directory**. This separate label identifies
the directory as the source of those navigation cards. Personal recommendations are not inferred.

To refresh: open the official directory, follow each course's link, check its visible heading and canonical URL, update the registry and aliases, then run the course-link tests and browser checks. Some automated HTTP requests receive 202 challenge pages; those are not treated as successful content verification.
