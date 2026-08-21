output "url" {
  value = module.ecs.url
}

output "ecr_repository_url" {
  value = module.storage.ecr_repository_url
}

output "cluster_name" {
  value = module.ecs.cluster_name
}

output "service_name" {
  value = module.ecs.service_name
}

output "task_definition_family" {
  value = module.ecs.task_definition_family
}

output "documents_bucket" {
  value = module.storage.documents_bucket
}
