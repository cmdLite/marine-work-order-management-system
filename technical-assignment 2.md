### Technical Assessment: Marine Work Order Management System

**Objective:** 
Build and deploy a mini-dashboard using Next.js, TypeScript, and Supabase that handles vessel-scoped work orders, crew management, and multi-role operations.

**Tech Stack & Deployment:**
* **Framework:** Next.js (App Router preferred)
* **Language:** TypeScript
* **Database & Client:** Supabase (**Prefers using the browser-client-side Supabase** for data fetching and mutations)
* **Deployment:** Must be deployed to a live platform (e.g., Vercel, Netlify). Please provide the active live URL in your submission.

**Requirements:**
1. **Mock Authentication System:** Do not implement Supabase Email Auth. Instead, create a sticky utility bar at the top of the application with **three dependent dropdowns**:
   * **Dropdown 1 (Vessel Selector):** Allows the reviewer to select the active vessel. The dashboard data, available members, and work orders must be scoped to the selected vessel. Admin users may view and manage all vessels.
   * **Dropdown 2 (Role Filter):** Allows the reviewer to filter users by role category (`Admin`, `Captain`, or `Crew`) for the selected vessel.
   * **Dropdown 3 (Member Switcher):** Dynamically populates and displays only the active users belonging to the chosen role and vessel. Selecting a member instantly switches the active application session to that user. The entire dashboard UI and permissions must instantly update to match that specific user's view.
2. **Admin Management Dashboard:**
   * **User Management:** The Admin must be able to create, view, update, and deactivate users. Validate required user fields, prevent duplicate user records, and prevent deactivation when it would leave an invalid assignment or active work order without an authorized owner.
   * **Role Management:** The Admin must be able to assign and update user roles (`Admin`, `Captain`, or `Crew`) while enforcing role-based permissions. 
   * **Vessel Management:** The Admin must be able to create, view, update, and deactivate vessels or ships. Validate required vessel fields and prevent duplicate vessel records.
   * **Vessel Assignment:** The Admin must be able to assign users to specific vessels, update those assignments, and remove a user from a vessel when needed. Captains and Crew may only access work orders for vessels to which they are assigned.
3. **Work Order Lifecycle & Data Schema:**
   * **Data Fields:** Each work order record must contain: `Work Order ID`, `Title`, `Issue`, `Solution` (optional until filled), and `Status`.
   * **Statuses:** Must strictly use `Open`, `In Progress`, and `Done`.
   * **Operations:**
     * **Captains** can create a work order for a specific vessel and assign it to an available Crew member under their command. The initial status is `Open`.
     * **Crew members** can view their assigned work orders, update the status to `In Progress`, document the `Solution`, and mark it as `Done`.
     * **Captains** review the work order once marked `Done` and can either **Attest** (fully close/approve the record) or **Reject** (send it back to assigned crew with a required rejection reason/comment).
4. **Documentation (ERD):** You must include an Entity Relationship Diagram (ERD) inside your repository (as an image file or using Mermaid.js in your `README.md`) clearly depicting your database schema and relationships.

**Evaluation Criteria:**
* **Logical Correctness & Reliability:** Evaluates how bug-free and stable the application is. The system should handle all workflows without breaking or losing data.
* **Code Organization & Cleanliness:** Evaluates how well the code is structured, readable, and maintainable. Proper folder organization, naming conventions, and clear logic.
* **ERD & Database Security:** Evaluates how well the database is designed and secured (RLS policies, SQL injection prevention, data protection, proper authorization checks).
* **UI/UX Friendliness:** Evaluates how intuitive and easy to use the interface is. Users should understand how to navigate and complete tasks without confusion.
* **UI Responsiveness:** Evaluates how well the interface adapts to different screen sizes and devices. Should work smoothly on desktop, tablet, and mobile.
* **Performance & Scalability:** Evaluates how well the application performs under load. The system should be fast and smooth with no lag or delays. It should handle large amounts of data efficiently and scale well without slowing down.
* **Deployment Execution:** A fully working deployment with seamless active connections to your live database instance. The application must be accessible and functional on the live URL.

**Submission Deliverables:**
1. Public GitHub repository link containing your code, ERD, and database schema.
2. Live production deployment URL.
3. **Database Schema:** Include either a `schema.sql` file or a complete database table schema document (showing all tables, columns, data types, primary keys, foreign keys, and indexes) alongside your ERD.
