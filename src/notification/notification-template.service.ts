import { Injectable } from "@nestjs/common";
import { NotificationTemplateRegistry } from "./notification-template.registry";
import { PrismaService } from "src/prisma";

interface RegistryTemplate {
  title: string;
  body: string;
  requiredFields?: string[];
}

@Injectable()
export class NotificationTemplateService {
  constructor(private readonly prisma: PrismaService) { }

  async render(
    templateKey: string,
    data: Record<string, unknown>,
  ) {
    let template =
      (NotificationTemplateRegistry as Record<string, RegistryTemplate>)[templateKey];

    if (!template) {
      // Look up template in the database
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
      }
    }

    if (!template) {
      throw new Error(
        `Template '${templateKey}' not found`,
      );
    }

    this.validate(template, data);

    return {
      title: template.title,
      body: this.replaceVariables(
        template.body,
        data,
      ),
    };
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
