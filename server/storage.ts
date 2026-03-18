import type { Project, InsertProject, Business, InsertBusiness, SearchJob, InsertSearchJob } from "@shared/schema";

export interface IStorage {
  // Projects
  getProjects(): Promise<Project[]>;
  getProject(id: number): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  deleteProject(id: number): Promise<void>;

  // Businesses
  getBusinessesByProject(projectId: number): Promise<Business[]>;
  createBusiness(business: InsertBusiness): Promise<Business>;
  createBusinessesBatch(businesses: InsertBusiness[]): Promise<Business[]>;
  deleteBusiness(id: number): Promise<void>;
  deleteBusinessesByProject(projectId: number): Promise<void>;

  // Search Jobs
  getSearchJobsByProject(projectId: number): Promise<SearchJob[]>;
  getSearchJob(id: number): Promise<SearchJob | undefined>;
  createSearchJob(job: InsertSearchJob): Promise<SearchJob>;
  updateSearchJob(id: number, updates: Partial<SearchJob>): Promise<SearchJob>;
}

class MemStorage implements IStorage {
  private projects: Map<number, Project> = new Map();
  private businesses: Map<number, Business> = new Map();
  private searchJobs: Map<number, SearchJob> = new Map();
  private nextId = { project: 1, business: 1, job: 1 };

  async getProjects(): Promise<Project[]> {
    return Array.from(this.projects.values()).sort((a, b) => b.id - a.id);
  }

  async getProject(id: number): Promise<Project | undefined> {
    return this.projects.get(id);
  }

  async createProject(data: InsertProject): Promise<Project> {
    const project: Project = { id: this.nextId.project++, ...data, description: data.description ?? null };
    this.projects.set(project.id, project);
    return project;
  }

  async deleteProject(id: number): Promise<void> {
    this.projects.delete(id);
    // Cascade
    for (const [bid, b] of this.businesses) {
      if (b.projectId === id) this.businesses.delete(bid);
    }
    for (const [jid, j] of this.searchJobs) {
      if (j.projectId === id) this.searchJobs.delete(jid);
    }
  }

  async getBusinessesByProject(projectId: number): Promise<Business[]> {
    return Array.from(this.businesses.values()).filter((b) => b.projectId === projectId);
  }

  async createBusiness(data: InsertBusiness): Promise<Business> {
    const biz: Business = {
      id: this.nextId.business++,
      projectId: data.projectId,
      name: data.name,
      address: data.address ?? null,
      city: data.city ?? null,
      zip: data.zip ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      website: data.website ?? null,
      category: data.category ?? null,
      source: data.source,
      sourceId: data.sourceId ?? null,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      isDuplicate: data.isDuplicate ?? false,
      duplicateOfId: data.duplicateOfId ?? null,
      rawData: data.rawData ?? null,
    };
    this.businesses.set(biz.id, biz);
    return biz;
  }

  async createBusinessesBatch(businesses: InsertBusiness[]): Promise<Business[]> {
    return Promise.all(businesses.map((b) => this.createBusiness(b)));
  }

  async deleteBusiness(id: number): Promise<void> {
    this.businesses.delete(id);
  }

  async deleteBusinessesByProject(projectId: number): Promise<void> {
    for (const [id, b] of this.businesses) {
      if (b.projectId === projectId) this.businesses.delete(id);
    }
  }

  async getSearchJobsByProject(projectId: number): Promise<SearchJob[]> {
    return Array.from(this.searchJobs.values())
      .filter((j) => j.projectId === projectId)
      .sort((a, b) => b.id - a.id);
  }

  async getSearchJob(id: number): Promise<SearchJob | undefined> {
    return this.searchJobs.get(id);
  }

  async createSearchJob(data: InsertSearchJob): Promise<SearchJob> {
    const job: SearchJob = {
      id: this.nextId.job++,
      projectId: data.projectId,
      query: data.query,
      location: data.location,
      sources: data.sources,
      status: data.status ?? "pending",
      totalFound: data.totalFound ?? 0,
      duplicatesRemoved: data.duplicatesRemoved ?? 0,
      createdAt: data.createdAt,
      finishedAt: data.finishedAt ?? null,
      errorMessage: data.errorMessage ?? null,
    };
    this.searchJobs.set(job.id, job);
    return job;
  }

  async updateSearchJob(id: number, updates: Partial<SearchJob>): Promise<SearchJob> {
    const existing = this.searchJobs.get(id);
    if (!existing) throw new Error(`SearchJob ${id} not found`);
    const updated = { ...existing, ...updates };
    this.searchJobs.set(id, updated);
    return updated;
  }
}

export const storage = new MemStorage();
