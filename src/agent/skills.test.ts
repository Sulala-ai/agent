import { describe, it, expect } from "vitest";
import { validateSkillContent } from "./skills.js";

describe("skills", () => {
  describe("validateSkillContent", () => {
    it("accepts valid skill with name and description", () => {
      const content = `---
name: test-skill
description: A test skill
---
# Body`;
      const r = validateSkillContent(content);
      expect(r.valid).toBe(true);
      expect(r.name).toBe("test-skill");
      expect(r.description).toBe("A test skill");
      expect(r.errors).toHaveLength(0);
    });

    it("rejects missing name", () => {
      const content = `---
description: Only description
---
# Body`;
      const r = validateSkillContent(content);
      expect(r.valid).toBe(false);
      expect(r.errors).toContain("Missing or empty name");
    });

    it("rejects missing description", () => {
      const content = `---
name: no-desc
---
# Body`;
      const r = validateSkillContent(content);
      expect(r.valid).toBe(false);
      expect(r.errors).toContain("Missing or empty description");
    });

    it("extracts required bins from metadata", () => {
      const content = `---
name: git
description: Git ops
metadata:
  { "sulala": { "requires": { "bins": ["git"] } } }
---
# Body`;
      const r = validateSkillContent(content);
      expect(r.valid).toBe(true);
      expect(r.bins).toEqual(["git"]);
    });

    it("accepts skill without metadata", () => {
      const content = `---
name: simple
description: No bins
---
# Body`;
      const r = validateSkillContent(content);
      expect(r.valid).toBe(true);
      expect(r.bins).toBeUndefined();
    });
  });
});
