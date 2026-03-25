import SwiftUI

struct ChildProfilesCard: View {
    let profiles: ChildProfilesResponse?

    var body: some View {
        HStack(spacing: 16) {
            if let profiles = profiles, !profiles.children.isEmpty {
                ForEach(profiles.children) { child in
                    childColumn(child)
                }
            } else if profiles != nil {
                Text("Ingen barneprofiler ennå")
                    .font(.system(size: 13))
                    .foregroundColor(Theme.muted)
                    .frame(maxWidth: .infinity)
            } else {
                ProgressView().tint(Theme.muted)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, Theme.cardPadding)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(Theme.card)
        .cornerRadius(Theme.cardCorner)
    }

    private func childColumn(_ child: ChildProfile) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            // Name
            Text(child.name)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(Theme.text)

            // Likes
            if !child.likes.isEmpty {
                HStack(spacing: 4) {
                    Text("👍")
                        .font(.system(size: 12))
                    Text(child.likes.prefix(5).joined(separator: ", "))
                        .font(.system(size: 12))
                        .foregroundColor(Theme.green)
                        .lineLimit(2)
                }
            }

            // Dislikes
            if !child.dislikes.isEmpty {
                HStack(spacing: 4) {
                    Text("👎")
                        .font(.system(size: 12))
                    Text(child.dislikes.prefix(5).joined(separator: ", "))
                        .font(.system(size: 12))
                        .foregroundColor(Theme.red)
                        .lineLimit(2)
                }
            }

            if child.likes.isEmpty && child.dislikes.isEmpty {
                Text("Ingen data ennå")
                    .font(.system(size: 12))
                    .foregroundColor(Theme.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
