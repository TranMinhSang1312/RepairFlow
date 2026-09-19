import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { parseApiEnvironment } from "@repairflow/config";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const environment = parseApiEnvironment(process.env);
    super({ adapter: new PrismaPg({ connectionString: environment.DATABASE_URL }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
