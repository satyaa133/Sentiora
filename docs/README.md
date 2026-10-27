# Sentiora Documentation

Every document in this folder is a canonical engineering document and must be treated as the source of truth during implementation.

1. [01_PRD_v2.1_FINAL.pdf](01_PRD_v2.1_FINAL.pdf) - Product Requirements Document (PRD)
Defines product vision, business goals, MVP scope, user personas, and product requirements.

2. [02_SRS_v1.0.pdf](02_SRS_v1.0.pdf) - Software Requirements Specification (SRS)
Functional requirements, non-functional requirements, system behavior, constraints, and acceptance criteria.

3. [03_Backend_Technical_Specification_v1.2.pdf](03_Backend_Technical_Specification_v1.2.pdf) - Backend Technical Specification
Backend architecture, services, APIs, processing pipeline, authentication, storage, and implementation guidance.

4. [04_Technical_Specification_v1.2.pdf](04_Technical_Specification_v1.2.pdf) - Technical Specification
Overall system architecture, technology stack, high-level design, and engineering decisions.

5. [05_API_Specification_v1.0.pdf](05_API_Specification_v1.0.pdf) - API Specification
REST API contracts, request/response formats, endpoints, validation, and status codes.

6. [06_Database_Schema_Design_v1.2.pdf](06_Database_Schema_Design_v1.2.pdf) - Database Schema Design
Collections, relationships, indexes, database architecture, and storage strategy.

7. [07_Development_Implementation_Plan.pdf](07_Development_Implementation_Plan.pdf) - Development & Implementation Plan
Defines the official implementation roadmap. Development MUST always follow this phase sequence.

8. [08_UIUX_Specification_v1.0_FINAL.pdf](08_UIUX_Specification_v1.0_FINAL.pdf) - UI/UX Specification
Design system, layouts, components, user flows, spacing, typography, and visual guidelines.

9. [TASKS.md](TASKS.md) - Project Tasks & Progress Tracker
Single source of truth for engineering progress, completed phases, and upcoming work.

10. [PROMPT_GUIDE.md](PROMPT_GUIDE.md) - AI Prompt Guide
Guide and instructions for AI agents on how to read docs, write code, and verify tasks.

11. [DESIGN.md](DESIGN.md) - Design System and Redesign Handoff
Tokens, components and screen layouts for the web app, extension popup and shared UI. Reference screenshots are in [design/](design/).

12. [RELEASE.md](RELEASE.md) - Release Guide
Production Docker Compose deployment, Chrome Web Store packaging, and YouTube capture limits.

13. [Capture_Module_v2_Technical_Design.pdf](Capture_Module_v2_Technical_Design.pdf) - Capture Module v2 Technical Design
Technical design for version 2 of the capture module (extension capture and the capture API).

14. [qa-audit/](qa-audit/) - QA Audit and Team Setup
[TEAM_SETUP.md](qa-audit/TEAM_SETUP.md) (setup walkthrough and troubleshooting), cross-machine checklist, bug register, and test results.

The documents in this directory are the canonical source of truth for the Sentiora project. If conflicts arise between implementation and documentation, the documentation should be reviewed before making engineering decisions.