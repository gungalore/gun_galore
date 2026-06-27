import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Category } from '@prisma/client';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findById(id: string): Promise<Category | null> {
    return this.prisma.category.findUnique({ where: { id } });
  }

  async findBySlug(slug: string): Promise<Category | null> {
    return this.prisma.category.findUnique({ where: { slug } });
  }

  /**
   * A category plus the context a public landing page needs: its parent (for
   * the breadcrumb) and its active children (for subcategory drill-down).
   * Returns null when the slug doesn't exist so the controller can 404.
   */
  async findBySlugTree(slug: string): Promise<{
    category: Category;
    parent: Category | null;
    children: Category[];
  } | null> {
    const category = await this.prisma.category.findUnique({ where: { slug } });
    if (!category || !category.isActive) return null;
    const [parent, children] = await Promise.all([
      category.parentId
        ? this.prisma.category.findUnique({ where: { id: category.parentId } })
        : Promise.resolve(null),
      this.prisma.category.findMany({
        where: { parentId: category.id, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);
    return { category, parent, children };
  }
}
