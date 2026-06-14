import { Injectable } from "@nestjs/common";
import { NotificationTemplateRegistry } from "./notification-template.registry";
import { PrismaService } from "src/prisma";

export interface RegistryTemplate {
  title: string;
  body: string;
  requiredFields?: string[];
}

@Injectable()
export class NotificationTemplateService {
  private readonly templateCache = new Map<string, RegistryTemplate>();

  constructor(private readonly prisma: PrismaService) { }

  /**
   * Fetches the template from either the registry, database, or local cache.
   */
  async fetchTemplate(templateKey: string): Promise<RegistryTemplate> {
    // 1. Check registry
    let template = (NotificationTemplateRegistry as Record<string, RegistryTemplate>)[templateKey];
    if (template) {
      return template;
    }

    // 2. Check local in-memory cache
    if (this.templateCache.has(templateKey)) {
      return this.templateCache.get(templateKey)!;
    }

    // 3. Look up template in the database
    const dbTemplate = await this.prisma.notificationTemplate.findUnique({
      where: { key: templateKey },
    });

    if (dbTemplate) {
      let requiredFields: string[] = [];
      if (dbTemplate.variables) {
        try {
          requiredFields = typeof dbTemplate.variables === 'string'
            ? JSON.parse(dbTemplate.variables)
            : (dbTemplate.variables as string[]);
        } catch {
          requiredFields = [];
        }
      }
      template = {
        title: dbTemplate.title,
        body: dbTemplate.body,
        requiredFields,
      };
      this.templateCache.set(templateKey, template);
      return template;
    }

    throw new Error(`Template '${templateKey}' not found`);
  }

  /**
   * Renders the fetched template with the provided user variables synchronously in-memory.
   */
  renderTemplate(
    template: RegistryTemplate,
    data: Record<string, unknown>,
  ) {
    this.validate(template, data);

    return {
      title: template.title,
      body: this.replaceVariables(
        template.body,
        data,
      ),
    };
  }

  /**
   * Fetches and renders a template in one step.
   */
  async render(
    templateKey: string,
    data: Record<string, unknown>,
  ) {
    const template = await this.fetchTemplate(templateKey);
    return this.renderTemplate(template, data);
  }

  private validate(
    template: RegistryTemplate,
    data: Record<string, unknown>,
  ) {
    const missingFields =
      template.requiredFields?.filter(
        (field: string) =>
          data[field] === undefined ||
          data[field] === null ||
          data[field] === '',
      ) || [];

    if (missingFields.length) {
      throw new Error(
        `Missing fields: ${missingFields.join(', ')}`,
      );
    }
  }

  private replaceVariables(
    content: string,
    data: Record<string, unknown>,
  ) {
    return content.replace(
      /{{(.*?)}}/g,
      (_, key) => String(data[key.trim()] ?? ''),
    );
  }
}
