#!/usr/bin/env python3
"""Create genre + subgenre folder hierarchy under videos/ matching the provided tree structure."""
import os
import shutil

# Genre tree matching the provided folder structure
GENRE_TREE = {
    "Femboy": [],
    "Twins Lesbian": [],
    "VeryRareTwins": [],
    "Cougar": [],
    "Casting": [],
    "PNP": [],
    "Stepmom": [],
    "Piss": [],
    "Daddy": [],
    "Gangbang": [],
    "Twins Gay": [],
    "Asian": [],
    "BDSM": [],
    "FTM": [],
    "Amateur": [],
    "Trans": ["Ladyboy", "Shemale", "Femboy", "Sissy", "Crossdresser", "TS", "Futanari", "FTM"],
    "Straight": [],
    "MILF": [],
    "Lesbian": ["Scissoring", "Tribbing", "Fingering", "Strapon", "Rough", "Amateur", "Group", "Twins"],
    "Femdom": ["Pegging", "Findom", "Chastity", "Foot Worship", "CEI", "JOI", "Humiliation", "SPH", "Strap On", "Orgasm Denial"],
    "Hentai": ["Anime", "Manga", "Tentacle", "Futanari", "3D", "Ahegao", "Netorare"],
    "Gay": [
        "Bear", "Twink", "Daddy", "Jock", "Leather", "Muscle", "Otter",
        "Rough", "Raw", "Group", "Amateur", "Italian", "Latino", "Asian",
        "Nani", "Dosio", "Twins", "Incest",
    ],
    "Anal": ["Rimming", "Pegging", "Fisting", "Double Penetration", "Ass To Mouth", "Gaping", "Anal Creampie", "Toys", "Prolapse"],
    "Bareback": ["Creampie", "Breeding", "Raw", "Cum Inside", "Internal Cumshot", "PNP Chemsex"],
    "BDSM Extended": ["Bondage", "Shibari", "Suspension", "Discipline", "Impact", "Pain", "Waxplay", "Collar", "Slave", "Petplay", "Dungeon"],
    "Bukkake": ["Gangbang", "Facial", "Cum Bath", "Group Cumshot"],
    "Cumshot": ["Facial", "Body Shot", "Internal", "Swallow", "Cum Swap", "Cum Eating"],
    "Deepthroat": ["Facefuck", "Throat Fuck", "Gagging", "Throat Bulge", "Irrumatio"],
    "Facial": ["Cumshot Facial", "Multiple Facials", "Glasses", "Covered"],
    "Fisting": ["Anal Fisting", "Vaginal Fisting", "Fisting", "Fisting"],
    "Handjob": ["Edging", "JOI", "Handjob"],
    "Interracial": ["BBC", "BWC", "IR Swapping", "IR Threesome"],
    "JOI": ["CEI", "Edging", "Denial", "Gooning", "Sph"],
    "Oral": ["Blowjob", "Cunnilingus", "Deepthroat", "Facesitting", "69", "Gagging"],
    "Orgy": ["Gangbang", "Foursome", "Group Sex", "Swinger", "Party"],
    "Pissing": ["Watersports", "Golden Shower", "Piss Drink", "Piss Play"],
    "Solo": ["Masturbation", "Dildo", "Toys", "Fingering", "Video Call", "Webcam"],
    "Spanking": ["OTK", "Barehand", "Paddle", "Crop", "Belt"],
    "Squirting": ["Female Ejaculation", "Gushing", "Squirt Facial"],
    "Threesome": ["MMF", "FFM", "DP", "FMF"],
    "BBW": ["SSBBW", "Chubby", "Curvy", "BBW Lesbian", "BBW Anal"],
    "Big Ass": ["PAWG", "Bubble Butt", "Ass Worship", "Ass Licking", "Booty"],
    "Big Dick": ["BBC", "BWC", "Monster Cock", "Huge Cock", "Big Dildo"],
    "Big Tits": ["Busty", "Huge Tits", "Natural", "Fake", "Titfuck", "Titjob"],
    "Chubby": ["Curvy", "Thick", "Plump", "Chubby Gay", "Chubby Lesbian"],
    "Ebony": ["Black", "Dark Skin", "Ebony Anal", "Ebony Lesbian", "BBC"],
    "Latina": ["Brazilian", "Mexican", "Colombian", "Cuban", "Spanish", "Argentinian"],
    "Mature": ["Cougar", "MILF", "Granny", "Older", "Grandma", "Experienced"],
    "Muscle": ["Bodybuilder", "Fit", "Muscle Worship", "Jock", "Beefy"],
    "Teen": ["18yr", "Young", "Tiny", "Teen Anal", "Teen Lesbian", "Amateur Teen"],
    "Twink": ["Young Twink", "Smooth", "Twink Anal", "Twink Gay"],
    "Cuckold": ["Hotwife", "Cuckolding", "Bull", "Stag Vixen"],
    "Fantasy": ["Elf", "Vampire", "Monster", "Tentacle", "Succubus", "Furry", "Giantess", "Dark Fantasy"],
    "Feet": ["Footjob", "Foot Worship", "Toes", "Socks", "High Heels", "Barefoot"],
    "Fetish": ["Latex", "Leather", "Rubber", "Smoking", "Pregnant", "Lactation", "Tattoo", "Piercing", "Stockings", "Panties", "Glasses", "Hairy", "Bald", "Armpit"],
    "Hotwife": ["Cuckold", "Wife Sharing", "Stag", "Vixen", "MFM Threesome"],
    "Latex": ["Rubber", "Catsuit", "Shiny", "Latex Fetish", "Gasmask"],
    "Massage": ["Erotic", "Nuru", "Happy End", "Oil", "Body Slide"],
    "Public": ["Outdoor", "Exhibitionism", "Risky", "Beach", "Car", "Park", "Changing Room"],
    "Roleplay": ["Fantasy", "Scenario", "Dirty Talk", "Character"],
    "Romantic": ["Sensual", "Passionate", "Lovemaking", "Cuddle", "Aftercare"],
    "Rough": ["Hardcore", "Choking", "Hair Pulling", "Face Slapping", "Spanking", "Bondage", "Aggressive", "Snuff", "Guro", "Blood", "Torture", "Waterboarding", "Breath Play", "Electro", "Needle Play", "Branding", "Mummification", "CBT", "Ball Busting", "Cock Torture", "Castration", "Forced Orgasm", "Rape Fantasy", "Knife Play", "Gagging Extreme", "Pulp"],
    "Schoolgirl": ["Uniform", "Teacher", "Student", "Classroom", "Detention"],
    "Sissy": ["Sissification", "Sissy Training", "Sissy Maid", "Caged", "Feminization"],
    "Uniform": ["Schoolgirl", "Nurse", "Teacher", "Maid", "Cheerleader", "Police", "Military", "Babysitter"],
    "Vintage": ["Classic", "80s", "90s", "Retro Retro", "Old School"],
    "AI_Generated": ["Stable Diffusion", "Midjourney", "Grok", "ComfyUI", "Deepfake", "Animated"],
    "Site_Archives": ["Motherless", "Xhamster", "Pornhub", "Gayporn", "Boyfriendtv", "Pornhub", "Spankbang"],
}

FLAT_FOLDERS = {"Downloads", "Uncategorized", "hidden"}


def main():
    videos_dir = r'c:\github\AphroArchive\videos'

    # Cleanup old auto-gen folders (keep downloads, hidden)
    print("Cleaning up old folders...")
    keep = {'downloads', 'hidden', 'Z', 'hidden'}
    for item in os.listdir(videos_dir):
        item_path = os.path.join(videos_dir, item)
        if os.path.isdir(item_path) and item not in keep:
            try:
                shutil.rmtree(item_path)
                print(f"  [REMOVED] {item}")
            except Exception as e:
                print(f"  [ERROR] {item}: {e}")

    # Create genre hierarchy
    print("\nCreating genre hierarchy...")
    for main_genre, subgenres in GENRE_TREE.items():
        main_path = os.path.join(videos_dir, main_genre)
        try:
            os.makedirs(main_path, exist_ok=True)
            print(f"  [MAIN] {main_genre}/")
        except Exception as e:
            print(f"  [ERROR] {main_genre}: {e}")
            continue

        for sub in subgenres:
            sub_path = os.path.join(main_path, sub)
            try:
                os.makedirs(sub_path, exist_ok=True)
            except Exception as e:
                print(f"       └── [ERROR] {sub}: {e}")

    # Create flat folders
    for folder in FLAT_FOLDERS:
        path = os.path.join(videos_dir, folder)
        try:
            os.makedirs(path, exist_ok=True)
            print(f"  [FLAT] {folder}/")
        except Exception as e:
            print(f"  [ERROR] {folder}: {e}")

    # Count
    total = 0
    for root, dirs, _ in os.walk(videos_dir):
        if os.path.basename(root) not in keep:
            total += len(dirs) + 1

    print(f"\n{'='*50}")
    print(f"Total folders: {total}")
    print(f"{'='*50}")


if __name__ == '__main__':
    main()